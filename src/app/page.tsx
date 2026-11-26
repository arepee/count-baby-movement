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
  formatSlotRange,
  formatTime,
  sumTotals,
} from "@/client/format";
import type { Entry, Slot, StateResponse } from "@/client/types";
import { CountSteppers, type Counts } from "@/components/Stepper";
import EntryCounts from "@/components/EntryCounts";
import NotificationCard from "@/components/NotificationCard";

const REFRESH_MS = 60_000;
const TICK_MS = 15_000;

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
      setData(s);
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
      {pending.length > 0 ? (
        <>
          <div className="banner">
            {pending.length} {pending.length === 1 ? "hour" : "hours"} to log
          </div>
          <PendingEditor key={pending[0].start} slot={pending[0]} tz={tz} onSaved={onSaved} onStale={load} />
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
  tz,
  onSaved,
  onStale,
}: {
  slot: Slot;
  tz: string;
  onSaved: (slot: Slot, entry: Entry) => void;
  onStale: () => void;
}) {
  const [counts, setCounts] = useState<Counts>({ kicks: 0, rolls: 0, other: 0 });
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
      </div>
      <CountSteppers counts={counts} onChange={setCounts} disabled={saving !== null} />
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
      <div className="card">
        <div className="big-status">All caught up</div>
        <div>
          <p className="muted small">{cur.isSleep ? "Night (sleep window)" : "This hour"}</p>
          <p className="slot-label">{formatSlotRange(cur, tz)}</p>
          <p className="muted">
            {cur.isSleep ? "Log the night after " : "Ready to log in "}
            <span className="tabular">
              {cur.isSleep ? formatTime(cur.end, tz) : formatDuration(remainingMs)}
            </span>
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Today</h2>
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
