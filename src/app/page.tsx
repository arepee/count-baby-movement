"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/client/api";
import {
  dayKey,
  deviceTimezone,
  entryDayKey,
  formatDuration,
  formatSlotLabel,
  formatTime,
  sumTotals,
} from "@/client/format";
import type { Counts, Entry, Slot, StateResponse, Tap } from "@/client/types";
import { CountSteppers } from "@/components/Stepper";
import EntryCounts from "@/components/EntryCounts";
import LiveTaps from "@/components/LiveTaps";
import NotificationCard from "@/components/NotificationCard";
import TodayTaps from "@/components/TodayTaps";

const REFRESH_MS = 60_000;
const TICK_MS = 15_000;
const ZERO: Counts = { kicks: 0, rolls: 0, other: 0 };

export default function LogPage() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // serverNow - clientNow, so countdowns follow the server's clock.
  const [skew, setSkew] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const reqId = useRef(0);
  // First run: initialise tracking (timezone + tracking_start). Shared promise so
  // overlapping loads don't POST twice; cleared on failure so Retry can redo it.
  const setupPromise = useRef<Promise<unknown> | null>(null);
  // True while live-tap requests are queued/in flight (see LiveTaps).
  const tapsBusy = useRef(false);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    try {
      let s = await api<StateResponse>("/api/state");
      if (id !== reqId.current) return; // a newer request superseded this one
      if (s.settings.initialized === false) {
        if (!setupPromise.current) {
          setupPromise.current = api("/api/setup", {
            method: "POST",
            body: { timezone: deviceTimezone() },
          }).catch((e: unknown) => {
            setupPromise.current = null;
            throw e;
          });
        }
        await setupPromise.current;
        if (id !== reqId.current) return;
        s = await api<StateResponse>("/api/state");
        if (id !== reqId.current) return;
      }
      const fresh = s;
      setData((prev) =>
        // While taps are in flight, a background refetch may or may not include them: keep
        // our tap view for the same slot; LiveTaps refetches again once its queue drains.
        tapsBusy.current && prev && prev.current.start === fresh.current.start
          ? { ...fresh, live: prev.live, lastTap: prev.lastTap, todayTaps: prev.todayTaps }
          : fresh,
      );
      setSkew(new Date(s.now).getTime() - Date.now());
      setNowMs(Date.now());
      setLoadError(null);
    } catch (e) {
      if (id !== reqId.current) return;
      setLoadError(errorMessage(e));
    }
  }, []);

  // Initial load + refetch on visibility and every 60s while visible.
  useEffect(() => {
    void load();
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.clearInterval(iv);
    };
  }, [load]);

  // Clock tick for the countdown.
  useEffect(() => {
    const iv = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(iv);
  }, []);

  const serverNow = nowMs + skew;
  const currentEnd = data ? new Date(data.current.end).getTime() : 0;

  // Wake exactly when the current slot ends (the 15s tick could be late), so live counts
  // reset and the refetch below fires promptly.
  useEffect(() => {
    if (!data) return;
    const ms = currentEnd - (Date.now() + skew);
    if (ms <= 0) return;
    const t = window.setTimeout(() => setNowMs(Date.now()), Math.min(ms + 50, 2 ** 31 - 1));
    return () => window.clearTimeout(t);
  }, [data, currentEnd, skew]);

  // When the current slot ends, it becomes pending: refetch (once per slot end).
  const endTriggered = useRef(0);
  useEffect(() => {
    if (data && serverNow >= currentEnd && endTriggered.current !== currentEnd) {
      endTriggered.current = currentEnd;
      void load();
    }
  }, [data, serverNow, currentEnd, load]);

  const onSaved = useCallback(
    (slot: Slot, entry: Entry) => {
      setData((d) =>
        d
          ? {
              ...d,
              pending: d.pending.filter((p) => p.start !== slot.start),
              recent: [entry, ...d.recent.filter((r) => r.slotStart !== entry.slotStart)],
            }
          : d,
      );
      void load();
    },
    [load],
  );

  const onTapConfirmed = useCallback((tap: Tap, live: Counts) => {
    setData((d) =>
      d
        ? {
            ...d,
            live,
            lastTap: tap,
            todayTaps: [tap, ...d.todayTaps.filter((t) => t.id !== tap.id)].slice(0, 200),
          }
        : d,
    );
  }, []);

  const onTapRemoved = useCallback((id: number, live: Counts) => {
    setData((d) => {
      if (!d) return d;
      const todayTaps = d.todayTaps.filter((t) => t.id !== id);
      return {
        ...d,
        live,
        todayTaps,
        lastTap: d.lastTap?.id === id ? (todayTaps[0] ?? null) : d.lastTap,
      };
    });
  }, []);

  const onTapsSettled = useCallback(() => void load(), [load]);

  if (!data) {
    return (
      <>
        <h1>Log</h1>
        {loadError ? (
          <div className="card">
            <p className="error">{loadError}</p>
            <button type="button" className="btn" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </>
    );
  }

  const tz = data.settings.timezone;
  const pending = data.pending;

  return (
    <>
      {loadError && <p className="error">{loadError}</p>}
      <LiveTaps
        current={data.current}
        live={data.live ?? ZERO}
        lastTap={data.lastTap ?? null}
        todayTaps={data.todayTaps ?? []}
        recent={data.recent}
        tz={tz}
        nowMs={serverNow}
        skewMs={skew}
        busyRef={tapsBusy}
        onTapConfirmed={onTapConfirmed}
        onTapRemoved={onTapRemoved}
        onSettled={onTapsSettled}
      />
      {pending.length > 0 ? (
        <>
          <div className="banner">
            {pending.length} {pending.length === 1 ? "hour" : "hours"} to log
          </div>
          <PendingEditor
            key={pending[0].start}
            slot={pending[0]}
            prefill={data.prefill?.[pending[0].start]}
            tz={tz}
            onSaved={onSaved}
            onStale={load}
          />
        </>
      ) : (
        <CaughtUp data={data} tz={tz} remainingMs={currentEnd - serverNow} nowMs={serverNow} />
      )}
      <NotificationCard />
    </>
  );
}

function PendingEditor({
  slot,
  prefill,
  tz,
  onSaved,
  onStale,
}: {
  slot: Slot;
  /** Counts from this hour's live taps, if any. */
  prefill: Counts | undefined;
  tz: string;
  onSaved: (slot: Slot, entry: Entry) => void;
  onStale: () => void;
}) {
  const [counts, setCounts] = useState<Counts>(prefill ?? ZERO);
  const [touched, setTouched] = useState(false);
  // Prefill can arrive or change after mount (a tap confirmed just after the hour ended, or
  // undone): follow it until the user edits the steppers themselves.
  const prefillKey = prefill ? `${prefill.kicks}/${prefill.rolls}/${prefill.other}` : "";
  const [seenPrefill, setSeenPrefill] = useState(prefillKey);
  if (prefillKey !== seenPrefill) {
    setSeenPrefill(prefillKey);
    if (!touched) setCounts(prefill ?? ZERO);
  }
  const tapTotal = prefill ? prefill.kicks + prefill.rolls + prefill.other : 0;
  const [saving, setSaving] = useState<null | "save" | "skip">(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (skipped: boolean) => {
    if (saving) return;
    setSaving(skipped ? "skip" : "save");
    setError(null);
    try {
      const body = skipped
        ? { slotStart: slot.start, kicks: 0, rolls: 0, other: 0, skipped: true }
        : { slotStart: slot.start, ...counts, skipped: false };
      const r = await api<{ entry: Entry }>("/api/entries", { method: "POST", body });
      onSaved(slot, r.entry);
    } catch (e) {
      setError(errorMessage(e));
      setSaving(null);
      // e.g. settings changed and this slot is no longer valid
      onStale();
    }
  };

  return (
    <div className="card">
      <div>
        <div className="slot-label">{formatSlotLabel(slot, tz)}</div>
        {slot.isSleep && <p className="muted small">One entry for the whole night</p>}
        {tapTotal > 0 && (
          <p className="muted small">
            From {tapTotal} {tapTotal === 1 ? "tap" : "taps"} — add any you missed
          </p>
        )}
      </div>
      <CountSteppers
        counts={counts}
        onChange={(c) => {
          setTouched(true);
          setCounts(c);
        }}
        disabled={saving !== null}
      />
      <div className="btn-col">
        <button
          type="button"
          className="btn primary big block"
          disabled={saving !== null}
          onClick={() => void submit(false)}
        >
          {saving === "save" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="btn block"
          disabled={saving !== null}
          onClick={() => void submit(true)}
        >
          {saving === "skip" ? "Saving…" : "Didn't track"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function CaughtUp({
  data,
  tz,
  remainingMs,
  nowMs,
}: {
  data: StateResponse;
  tz: string;
  remainingMs: number;
  nowMs: number;
}) {
  const today = dayKey(new Date(nowMs), tz);
  // The night counts toward the day it ends (wake-up day).
  const todays = data.recent.filter((e) => entryDayKey(e, tz) === today);
  const totals = sumTotals(todays);
  const cur = data.current;

  return (
    <>
      {/* The slot itself is labelled on the Right now card above; here just when it can be logged. */}
      <div className="card">
        <div>
          <div className="big-status">All caught up</div>
          <p className="muted">
            {cur.isSleep ? "Log the night after " : "Log this hour in "}
            <span className="tabular">
              {cur.isSleep ? formatTime(cur.end, tz) : formatDuration(remainingMs)}
            </span>
          </p>
        </div>
        <div>
          <h2 className="sub-head">Today</h2>
          <div className="totals">
            <div>
              <div className="num">{totals.kicks}</div>
              <div className="lbl">Kicks</div>
            </div>
            <div>
              <div className="num">{totals.rolls}</div>
              <div className="lbl">Rolls</div>
            </div>
            <div>
              <div className="num">{totals.other}</div>
              <div className="lbl">Other</div>
            </div>
          </div>
        </div>
      </div>

      <TodayTaps taps={data.todayTaps ?? []} tz={tz} />

      {data.recent.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Recent</h2>
            <Link href="/history" className="head-link">
              History
            </Link>
          </div>
          <ul className="list">
            {data.recent.slice(0, 6).map((e) => (
              <li key={e.id} className="entry-row" style={{ cursor: "default" }}>
                <span className="entry-time">
                  {formatSlotLabel({ start: e.slotStart, end: e.slotEnd, isSleep: e.isSleep }, tz)}
                </span>
                <EntryCounts entry={e} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
