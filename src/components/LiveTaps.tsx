"use client";

import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { ApiError, api, errorMessage } from "@/client/api";
import { formatAgo, formatCompactRange, formatTime, tapKindLabel } from "@/client/format";
import type {
  Counts,
  Entry,
  Slot,
  Tap,
  TapDeleteResponse,
  TapKind,
  TapResponse,
} from "@/client/types";

/** A tap recorded on the device that the server hasn't confirmed yet. */
type TapOp = { key: number; type: "tap"; kind: TapKind; at: number };
/** An undo waiting to be sent: targets a confirmed tap (tapId) or a tap op still in flight (targetKey). */
type UndoOp = {
  key: number;
  type: "undo";
  kind: TapKind;
  at: number;
  tapId: number | null;
  targetKey: number | null;
};
type Op = TapOp | UndoOp;

const KINDS: { kind: TapKind; field: keyof Counts }[] = [
  { kind: "kick", field: "kicks" },
  { kind: "roll", field: "rolls" },
  { kind: "other", field: "other" },
];

const FIELD: Record<TapKind, keyof Counts> = { kick: "kicks", roll: "rolls", other: "other" };

/**
 * "Right now" card: one-tap Kick / Roll / Other for the in-progress slot.
 *
 * Taps are optimistic: each press is queued and shown instantly; requests go out one at a
 * time (so each response's `live` covers every earlier tap), and a failed tap is rolled back
 * with an inline error. The parent keeps the server-confirmed `live`/`lastTap`/`todayTaps`.
 */
export default function LiveTaps({
  current,
  live,
  lastTap,
  todayTaps,
  recent,
  tz,
  nowMs,
  skewMs,
  busyRef,
  onTapConfirmed,
  onTapRemoved,
  onSettled,
}: {
  current: Slot;
  live: Counts;
  lastTap: Tap | null;
  todayTaps: Tap[];
  recent: Entry[];
  tz: string;
  /** Current time on the server's clock (ms). */
  nowMs: number;
  /** serverNow − Date.now(), for stamping optimistic taps on the server's clock. */
  skewMs: number;
  /** Set while requests are queued/in flight, so background refetches don't double count. */
  busyRef: MutableRefObject<boolean>;
  onTapConfirmed: (tap: Tap, live: Counts) => void;
  onTapRemoved: (id: number, live: Counts) => void;
  /** Queue drained (or an error needs a refresh): refetch state to reconcile. */
  onSettled: () => void;
}) {
  const [ops, setOps] = useState<Op[]>([]);
  const opsRef = useRef<Op[]>([]);
  const nextKey = useRef(1);
  const running = useRef(false);
  const serverIds = useRef(new Map<number, number>()); // tap op key -> server tap id
  const [error, setError] = useState<string | null>(null);

  const updateOps = useCallback((fn: (o: Op[]) => Op[]) => {
    opsRef.current = fn(opsRef.current);
    setOps(opsRef.current);
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    busyRef.current = true;
    try {
      while (opsRef.current.length > 0) {
        const op = opsRef.current[0];
        if (op.type === "tap") {
          try {
            const r = await api<TapResponse>("/api/taps", { method: "POST", body: { kind: op.kind } });
            serverIds.current.set(op.key, r.tap.id);
            // Same tick: parent adopts the server count and the op leaves the queue together.
            onTapConfirmed(r.tap, r.live);
          } catch (e) {
            setError(`${tapKindLabel(op.kind)} not saved: ${errorMessage(e)}`);
          }
        } else {
          const id = op.tapId ?? (op.targetKey != null ? serverIds.current.get(op.targetKey) : undefined);
          if (id != null) {
            try {
              const r = await api<TapDeleteResponse>(`/api/taps/${id}`, { method: "DELETE" });
              onTapRemoved(id, r.live);
            } catch (e) {
              // 409: that hour was saved meanwhile; 404: already gone. The refetch below fixes the view.
              setError(e instanceof ApiError && e.status === 404 ? "That tap was already removed" : errorMessage(e));
            }
          }
          // id == null: the tap it targeted failed to save, so there's nothing to undo.
        }
        updateOps((o) => o.filter((x) => x.key !== op.key));
      }
    } finally {
      running.current = false;
      busyRef.current = false;
      serverIds.current.clear();
      onSettled();
    }
  }, [busyRef, onTapConfirmed, onTapRemoved, onSettled, updateOps]);

  const tap = (kind: TapKind) => {
    setError(null);
    try {
      navigator.vibrate?.(10);
    } catch {
      /* not supported */
    }
    const op: TapOp = { key: nextKey.current++, type: "tap", kind, at: Date.now() + skewMs };
    updateOps((o) => [...o, op]);
    void pump();
  };

  const curStart = new Date(current.start).getTime();
  const curEnd = new Date(current.end).getTime();
  const rolledOver = nowMs >= curEnd; // slot ended; the refetch for the next one is on its way
  const inCurrent = (at: number) => (rolledOver ? at >= curEnd : at >= curStart && at < curEnd);

  // Confirmed taps the user could still undo (newest first): not in an hour that's saved.
  const savedRanges = recent.map((e) => [new Date(e.slotStart).getTime(), new Date(e.slotEnd).getTime()]);
  const inSavedHour = (t: Tap) => {
    const at = new Date(t.at).getTime();
    return savedRanges.some(([s, e]) => at >= s && at < e);
  };
  const confirmed: Tap[] = [];
  const seen = new Set<number>();
  for (const t of [...(lastTap ? [lastTap] : []), ...todayTaps]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    confirmed.push(t);
  }
  confirmed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const undoneKeys = new Set<number>();
  const undoneIds = new Set<number>();
  for (const o of ops) {
    if (o.type !== "undo") continue;
    if (o.targetKey != null) undoneKeys.add(o.targetKey);
    if (o.tapId != null) undoneIds.add(o.tapId);
  }
  const liveOps = ops.filter((o): o is TapOp => o.type === "tap" && !undoneKeys.has(o.key));

  // Displayed counts: server count + optimistic taps − pending undos.
  const counts: Counts = rolledOver ? { kicks: 0, rolls: 0, other: 0 } : { ...live };
  for (const o of ops) {
    if (!inCurrent(o.at)) continue;
    const f = FIELD[o.kind];
    if (o.type === "tap") counts[f] += 1;
    else counts[f] = Math.max(0, counts[f] - 1);
  }

  // Most recent movement (optimistic first).
  const newestOp = liveOps[liveOps.length - 1];
  const newestConfirmed = confirmed.find((t) => !undoneIds.has(t.id));
  const last: { at: string; kind: TapKind } | null = newestOp
    ? { at: new Date(newestOp.at).toISOString(), kind: newestOp.kind }
    : newestConfirmed
      ? { at: newestConfirmed.at, kind: newestConfirmed.kind }
      : null;

  // What Undo would remove: the newest unsent/in-flight tap, else the newest undoable confirmed tap.
  const undoTarget: { op: TapOp } | { tap: Tap } | null = newestOp
    ? { op: newestOp }
    : (() => {
        const t = confirmed.find((c) => !undoneIds.has(c.id) && !inSavedHour(c));
        return t ? { tap: t } : null;
      })();

  const undo = () => {
    if (!undoTarget) return;
    setError(null);
    if ("op" in undoTarget) {
      const target = undoTarget.op;
      const inFlight = running.current && opsRef.current[0]?.key === target.key;
      if (!inFlight) {
        // Not sent yet: just drop it.
        updateOps((o) => o.filter((x) => x.key !== target.key));
        return;
      }
      updateOps((o) => [
        ...o,
        { key: nextKey.current++, type: "undo", kind: target.kind, at: target.at, tapId: null, targetKey: target.key },
      ]);
    } else {
      const t = undoTarget.tap;
      updateOps((o) => [
        ...o,
        {
          key: nextKey.current++,
          type: "undo",
          kind: t.kind,
          at: new Date(t.at).getTime(),
          tapId: t.id,
          targetKey: null,
        },
      ]);
    }
    void pump();
  };

  const undoKind = undoTarget ? ("op" in undoTarget ? undoTarget.op.kind : undoTarget.tap.kind) : null;
  const undoLabel = undoTarget
    ? "op" in undoTarget
      ? `Undo last tap (${tapKindLabel(undoTarget.op.kind)}, just now)`
      : `Undo last tap (${tapKindLabel(undoTarget.tap.kind)} at ${formatTime(undoTarget.tap.at, tz)})`
    : "Nothing to undo";

  return (
    <section className="card live" aria-label="Right now">
      <div className="card-head">
        <h2>Right now</h2>
        <span className="live-slot tabular">
          {current.isSleep ? "Night" : formatCompactRange(current, tz)}
        </span>
      </div>
      <div className="tap-row">
        {KINDS.map(({ kind, field }) => (
          <TapButton key={kind} kind={kind} count={counts[field]} onTap={() => tap(kind)} />
        ))}
      </div>
      <div className="live-foot">
        <p className="muted small live-last" aria-live="polite">
          {last ? (
            <>
              Last movement{" "}
              <span className="nowrap">
                {formatAgo(last.at, nowMs, tz)} · {tapKindLabel(last.kind)}
              </span>
            </>
          ) : (
            "No movements tapped yet today"
          )}
        </p>
        <button
          type="button"
          className="btn undo-btn"
          disabled={!undoTarget}
          aria-label={undoLabel}
          onClick={undo}
        >
          Undo{undoKind ? ` ${tapKindLabel(undoKind)}` : ""}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function TapButton({ kind, count, onTap }: { kind: TapKind; count: number; onTap: () => void }) {
  // JS-driven pressed state: reliable feedback on iOS Safari, where :active can lag or not fire.
  const [pressed, setPressed] = useState(false);
  const label = tapKindLabel(kind);
  return (
    <button
      type="button"
      className={`tap-btn${pressed ? " pressed" : ""}`}
      aria-label={`${label} — ${count} this hour`}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={onTap}
    >
      <span className="tap-kind">{label}</span>
      <span className="tap-count tabular">{count}</span>
    </button>
  );
}
