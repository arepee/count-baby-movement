// Client-side helpers for the Insights tab and the Doctor summary.
import type { DayStat, Settings } from "@/client/types";

/** "Week 31 + 2 days" / "Week 31" */
export function formatPregnancy(p: { week: number; day: number }): string {
  if (p.day === 0) return `Week ${p.week}`;
  return `Week ${p.week} + ${p.day} day${p.day === 1 ? "" : "s"}`;
}

function keyToUtcNoon(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

const utcFmt = new Map<string, Intl.DateTimeFormat>();
function fmtKey(key: string, opts: Intl.DateTimeFormatOptions): string {
  const k = JSON.stringify(opts);
  let f = utcFmt.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" });
    utcFmt.set(k, f);
  }
  return f.format(keyToUtcNoon(key));
}

/** "Thu" for a day key. */
export function keyWeekday(key: string): string {
  return fmtKey(key, { weekday: "short" });
}

/** "Thu, Nov 26" for a day key. */
export function keyShort(key: string): string {
  return fmtKey(key, { weekday: "short", month: "short", day: "numeric" });
}

/** "Nov 26" for a day key (no weekday; narrow tables). */
export function keyCompact(key: string): string {
  return fmtKey(key, { month: "short", day: "numeric" });
}

/** "Nov 26, 2026" for a day key. */
export function keyLong(key: string): string {
  return fmtKey(key, { month: "short", day: "numeric", year: "numeric" });
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * The grid's hour columns: local START hour (0..23) of each awake slot, in order from
 * the wake time (awake slots are anchored to the wake minute and run until sleep
 * starts). Wake 07:30 / sleep 23:30 → [7, 8, …, 22]. Equal times → all 24 hours.
 */
export function awakeColumns(
  s: Pick<Settings, "sleepStart" | "sleepEnd">,
): number[] {
  const wake = toMin(s.sleepEnd);
  const sleep = toMin(s.sleepStart);
  const awakeLen = sleep === wake ? 1440 : (sleep - wake + 1440) % 1440;
  const hours: number[] = [];
  for (let off = 0; off < awakeLen; off += 60) {
    const h = Math.floor(((wake + off) % 1440) / 60);
    if (!hours.includes(h)) hours.push(h);
  }
  return hours;
}

/** Wake minute (0..59): awake slots start at this minute past each hour. */
export function wakeMinute(s: Pick<Settings, "sleepEnd">): number {
  return toMin(s.sleepEnd) % 60;
}

/** Round to at most one decimal, dropping a trailing ".0". */
export function round1(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export const LOW_MIN_BASELINE_DAYS = 3;

/**
 * Days flagged as low: day total < 50% of the mean total of the previous 7 days
 * that have data (logged hours > 0). Only days that have data themselves and a
 * baseline of at least LOW_MIN_BASELINE_DAYS days are considered; `excludeKey`
 * (today, still in progress) is never flagged.
 * Returns key → baseline mean for flagged days.
 */
export function flagLowDays(
  days: DayStat[],
  excludeKey?: string,
): Map<string, number> {
  const chrono = [...days].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const flagged = new Map<string, number>();
  const withData: DayStat[] = [];
  for (const d of chrono) {
    const hasData = d.loggedHours > 0;
    if (hasData && d.key !== excludeKey) {
      const prev = withData.slice(-7);
      if (prev.length >= LOW_MIN_BASELINE_DAYS) {
        const mean = prev.reduce((s, x) => s + x.total, 0) / prev.length;
        if (mean > 0 && d.total < 0.5 * mean) flagged.set(d.key, mean);
      }
    }
    if (hasData) withData.push(d);
  }
  return flagged;
}
