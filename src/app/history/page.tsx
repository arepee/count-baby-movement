"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/client/api";
import { formatDayHeading, formatSlotLabel, formatSlotRange, groupByDay, sumTotals } from "@/client/format";
import type { Entry, Settings } from "@/client/types";
import EntryCounts from "@/components/EntryCounts";
import { CountSteppers, type Counts } from "@/components/Stepper";

const PAGE_DAYS = 14;
const DAY_MS = 86_400_000;

function sortNewestFirst(list: Entry[]): Entry[] {
  return [...list].sort((a, b) => (a.slotStart < b.slotStart ? 1 : a.slotStart > b.slotStart ? -1 : 0));
}

export default function HistoryPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [oldest, setOldest] = useState<number | null>(null); // ms; `from` of the oldest loaded page
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const loadRange = useCallback(async (fromMs: number, toMs: number) => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
      });
      const r = await api<{ entries: Entry[] }>(`/api/entries?${q}`);
      setEntries((prev) => {
        const byId = new Map(prev.map((e) => [e.id, e]));
        for (const e of r.entries) byId.set(e.id, e);
        return sortNewestFirst([...byId.values()]);
      });
      setOldest(fromMs);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ settings: Settings }>("/api/settings");
        setSettings(r.settings);
      } catch (e) {
        setError(errorMessage(e));
        return;
      }
      // Pad `to` so slots ending right now are included.
      const to = Date.now() + DAY_MS;
      await loadRange(to - (PAGE_DAYS + 1) * DAY_MS, to);
    })();
  }, [loadRange]);

  const loadMore = () => {
    if (oldest === null || loading) return;
    void loadRange(oldest - PAGE_DAYS * DAY_MS, oldest);
  };

  const onUpdated = (e: Entry) => {
    setEntries((prev) => prev.map((x) => (x.id === e.id ? e : x)));
    setOpenId(null);
  };
  const onDeleted = (id: number) => {
    setEntries((prev) => prev.filter((x) => x.id !== id));
    setOpenId(null);
  };

  const tz = settings?.timezone ?? "UTC";
  const trackingStartMs = settings ? new Date(settings.trackingStart).getTime() : 0;
  const hasMore = oldest !== null && oldest > trackingStartMs - DAY_MS;
  const groups = settings ? groupByDay(entries, tz) : [];

  return (
    <>
      <div className="day-head">
        <h1>History</h1>
        <a className="btn" href="/api/export.csv" download>
          Export CSV
        </a>
      </div>

      {error && <p className="error">{error}</p>}
      {!settings && !error && <p className="muted">Loading…</p>}
      {settings && !loading && entries.length === 0 && !error && (
        <p className="muted">No entries yet.</p>
      )}

      {groups.map((g) => {
        const t = sumTotals(g.items);
        return (
          <section key={g.key} className="card">
            <div className="day-head">
              <h2>{formatDayHeading(g.key, tz)}</h2>
              <span className="day-totals">
                K {t.kicks} · R {t.rolls} · O {t.other}
              </span>
            </div>
            <ul className="list">
              {g.items.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="entry-row"
                    aria-expanded={openId === e.id}
                    onClick={() => setOpenId(openId === e.id ? null : e.id)}
                  >
                    <span className="entry-time">
                      {e.isSleep ? "Night · " : ""}
                      {formatSlotRange({ start: e.slotStart, end: e.slotEnd, isSleep: e.isSleep }, tz)}
                    </span>
                    <EntryCounts entry={e} />
                  </button>
                  {openId === e.id && (
                    <EditPanel
                      key={e.id + e.updatedAt}
                      entry={e}
                      tz={tz}
                      onUpdated={onUpdated}
                      onDeleted={onDeleted}
                      onCancel={() => setOpenId(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {settings && hasMore && (
        <button type="button" className="btn block" disabled={loading} onClick={loadMore}>
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}

function EditPanel({
  entry,
  tz,
  onUpdated,
  onDeleted,
  onCancel,
}: {
  entry: Entry;
  tz: string;
  onUpdated: (e: Entry) => void;
  onDeleted: (id: number) => void;
  onCancel: () => void;
}) {
  const [counts, setCounts] = useState<Counts>({
    kicks: entry.kicks,
    rolls: entry.rolls,
    other: entry.other,
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (skipped: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const body = skipped
        ? { kicks: 0, rolls: 0, other: 0, skipped: true }
        : { ...counts, skipped: false };
      const r = await api<{ entry: Entry }>(`/api/entries/${entry.id}`, { method: "PATCH", body });
      onUpdated(r.entry);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const del = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/entries/${entry.id}`, { method: "DELETE" });
      onDeleted(entry.id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="edit-panel">
      <p className="muted small">
        Editing {formatSlotLabel({ start: entry.slotStart, end: entry.slotEnd, isSleep: entry.isSleep }, tz)}
        {entry.skipped ? " (currently skipped)" : ""}
      </p>
      <CountSteppers counts={counts} onChange={setCounts} disabled={busy} />
      <div className="btn-row">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void patch(false)}>
          Save
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="btn-row">
        {!entry.skipped && (
          <button type="button" className="btn" disabled={busy} onClick={() => void patch(true)}>
            Didn&apos;t track
          </button>
        )}
        <button
          type="button"
          className={confirmDelete ? "btn danger confirm" : "btn danger"}
          disabled={busy}
          onClick={() => void del()}
        >
          {confirmDelete ? "Tap to confirm delete" : "Delete"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
