// Pure aggregation for the Insights tab (see docs/SPEC.md "Insights (v2)").
// Safe for client and server; the route only loads entries + settings.
//
// Day attribution follows slotDayKey(): awake slots belong to the local day they
// start, the night slot to the local day it ends. Entries are attributed using
// their own stored range (they may predate a sleep-window change); "expected"
// hours for coverage use the slots under the current settings.

import { slotContaining, slotDayKey, slotsBetween } from "./slots";
import { addDays, localDate, localToUtc, toLocal, type LocalDate } from "./tz";
import type { DayStat, Entry, InsightsResponse, Settings, Slot } from "./types";

const HOUR = 3_600_000;
const DAY = 86_400_000;
export const MIN_DAYS = 7;
export const MAX_DAYS = 120;
export const DEFAULT_DAYS = 28;
/** Previous days considered for usualByNow, the grid and hourAvg. */
export const HISTORY_DAYS = 7;

type Ms = number | string | Date;
const toMs = (t: Ms): number => (typeof t === "number" ? t : new Date(t).getTime());
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const hours = (startMs: number, endMs: number) => (endMs - startMs) / HOUR;

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: LocalDate) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;
function parseKey(key: string): LocalDate {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}
/** Days since 1970-01-01 of a "YYYY-MM-DD" key (for date differences). */
const dayNum = (key: string) => {
  const d = parseKey(key);
  return Math.round(Date.UTC(d.year, d.month - 1, d.day) / DAY);
};
/** 0 = Monday … 6 = Sunday. */
const isoWeekday = (key: string) => {
  const d = parseKey(key);
  return (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "24 Nov" */
const shortDate = (key: string) => {
  const d = parseKey(key);
  return `${d.day} ${MONTHS[d.month - 1]}`;
};

export function clampDays(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(n)));
}

/**
 * Pregnancy age on `todayKey`: 280 days − (dueDate − today). Null without a due date
 * or when the result is outside 0..44 weeks.
 */
export function pregnancyAge(dueDate: string | null, todayKey: string): { week: number; day: number } | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const age = 280 - (dayNum(dueDate) - dayNum(todayKey));
  const week = Math.floor(age / 7);
  if (age < 0 || week > 44) return null;
  return { week, day: age % 7 };
}

type Attributed = { e: Entry; key: string; start: number; end: number; total: number };

/** Slots (current settings) that belong to local day `key`, oldest first. */
export function daySlots(key: string, s: Settings): Slot[] {
  const d = parseKey(key);
  // The night ending on D starts on D-1; awake slots starting on D end by early D+1.
  const from = localToUtc(addDays(d, -1), 0, s.timezone);
  const to = localToUtc(addDays(d, 2), 0, s.timezone);
  return slotsBetween(from, to, s).filter((x) => slotDayKey(x, s.timezone) === key);
}

function emptyDay(key: string): DayStat {
  return { key, kicks: 0, rolls: 0, other: 0, total: 0, loggedHours: 0, skippedHours: 0, night: null };
}

function dayStat(key: string, list: Attributed[]): DayStat {
  const out = emptyDay(key);
  let logged = 0;
  let skipped = 0;
  for (const a of list) {
    const h = hours(a.start, a.end);
    if (a.e.skipped) {
      skipped += h;
      continue;
    }
    logged += h;
    out.kicks += a.e.kicks;
    out.rolls += a.e.rolls;
    out.other += a.e.other;
    out.total += a.total;
    if (a.e.isSleep) out.night = (out.night ?? 0) + a.total;
  }
  out.loggedHours = round(logged, 2);
  out.skippedHours = round(skipped, 2);
  return out;
}

/**
 * Movements and coverage of day `key` counting only slots that ended by `cutoffMs`:
 * `expected` = hours of the day's slots (current settings) ended by then,
 * `logged` = hours of non-skipped entries ended by then.
 */
function byCutoff(key: string, list: Attributed[], cutoffMs: number, s: Settings) {
  let expected = 0;
  for (const slot of daySlots(key, s)) {
    const st = toMs(slot.start);
    const en = toMs(slot.end);
    if (en <= cutoffMs) expected += hours(st, en);
  }
  let logged = 0;
  let total = 0;
  for (const a of list) {
    if (a.end > cutoffMs || a.e.skipped) continue;
    logged += hours(a.start, a.end);
    total += a.total;
  }
  return { expected, logged, total };
}

/**
 * Build the Insights payload. `entries` must include every entry overlapping the
 * last max(days, 8) local days (extra entries are ignored). `days` is clamped to 7..120.
 */
export function buildInsights(entries: Entry[], settings: Settings, now: Ms, days: number): InsightsResponse {
  const tz = settings.timezone;
  const nowMs = toMs(now);
  if (Number.isNaN(nowMs)) throw new Error("Invalid instant");
  const n = clampDays(days);

  const today = localDate(nowMs, tz);
  const todayKey = keyOf(today);
  // First day with anything trackable: the day the slot containing trackingStart is attributed to.
  const firstKey = slotDayKey(slotContaining(settings.trackingStart, settings), tz);
  const tracked = (key: string) => key >= firstKey && key <= todayKey;

  // Attribute entries to day keys.
  const byDay = new Map<string, Attributed[]>();
  for (const e of entries) {
    const start = toMs(e.slotStart);
    const end = toMs(e.slotEnd);
    if (!(end > start) || start >= nowMs) continue;
    const key = slotDayKey({ start, end, isSleep: e.isSleep }, tz);
    const list = byDay.get(key) ?? [];
    list.push({ e, key, start, end, total: e.skipped ? 0 : e.kicks + e.rolls + e.other });
    byDay.set(key, list);
  }
  const listFor = (key: string) => byDay.get(key) ?? [];

  const keysBack = (count: number) => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push(keyOf(addDays(today, -i)));
    return out;
  };

  // ---- days (newest first) ----
  const dayStats = keysBack(n)
    .filter(tracked)
    .map((k) => dayStat(k, listFor(k)));
  const todayStat = dayStat(todayKey, listFor(todayKey));

  // ---- usualByNow ----
  const { hour, minute, second } = toLocal(nowMs, tz);
  const minutesOfDay = hour * 60 + minute + second / 60;
  let usualSum = 0;
  let usualDays = 0;
  for (let i = 1; i <= HISTORY_DAYS; i++) {
    const d = addDays(today, -i);
    const key = keyOf(d);
    if (!tracked(key)) continue;
    const cutoff = localToUtc(d, minutesOfDay, tz);
    const c = byCutoff(key, listFor(key), cutoff, settings);
    if (c.expected <= 0 || c.logged < 0.5 * c.expected) continue;
    usualSum += c.total;
    usualDays++;
  }
  const usualRaw = usualDays >= 3 ? usualSum / usualDays : null;
  const todaySoFar = byCutoff(todayKey, listFor(todayKey), nowMs, settings);
  const todayCovered = todaySoFar.expected > 0 && todaySoFar.logged >= 0.5 * todaySoFar.expected;
  const lowerThanUsual =
    usualRaw !== null && usualRaw >= 10 && todayStat.total < 0.5 * usualRaw && todayCovered;

  // ---- grid + hourAvg (last 7 days incl. today, newest first) ----
  const grid = keysBack(HISTORY_DAYS)
    .filter(tracked)
    .map((key) => {
      const cells: (number | null)[] = Array(24).fill(null);
      for (const a of listFor(key)) {
        if (a.e.isSleep || a.e.skipped) continue;
        const h = toLocal(a.start, tz).hour;
        cells[h] = (cells[h] ?? 0) + a.total; // two slots can share an hour on a fall-back day
      }
      return { key, cells, night: dayStat(key, listFor(key)).night };
    });
  const hourAvg = Array.from({ length: 24 }, (_, h) => {
    const vals = grid.map((r) => r.cells[h]).filter((v): v is number => v !== null);
    return vals.length ? round(vals.reduce((x, y) => x + y, 0) / vals.length, 1) : null;
  });

  // ---- weeks (newest first) ----
  const pregnancy = pregnancyAge(settings.dueDate, todayKey);
  const groupOf = (key: string): { id: string; label: string; week: number | null } => {
    if (pregnancy && settings.dueDate) {
      const week = Math.floor((280 - (dayNum(settings.dueDate) - dayNum(key))) / 7);
      return { id: `w${week}`, label: `Week ${week}`, week };
    }
    const monday = keyOf(addDays(parseKey(key), -isoWeekday(key)));
    return { id: monday, label: shortDate(monday), week: null };
  };
  type Acc = InsightsResponse["weeks"][number] & { id: string; sum: number };
  const weeks: Acc[] = [];
  for (const d of dayStats) {
    const g = groupOf(d.key);
    let w = weeks[weeks.length - 1];
    if (!w || w.id !== g.id) {
      w = { id: g.id, label: g.label, week: g.week, startKey: d.key, endKey: d.key, avgPerDay: 0, days: 0, sum: 0 };
      weeks.push(w);
    }
    w.startKey = d.key; // dayStats are newest first, so the last one seen is the oldest
    // Average over complete days that have data (today is partial; empty days would read as zero).
    if (d.key !== todayKey && d.loggedHours > 0) {
      w.days++;
      w.sum += d.total;
    }
  }

  return {
    now: new Date(nowMs).toISOString(),
    settings,
    pregnancy,
    today: {
      ...todayStat,
      usualByNow: usualRaw === null ? null : round(usualRaw, 1),
      usualDays,
      lowerThanUsual,
    },
    days: dayStats,
    grid,
    hourAvg,
    weeks: weeks.map(({ label, week, startKey, endKey, days: c, sum }) => ({
      label,
      week,
      startKey,
      endKey,
      avgPerDay: c ? round(sum / c, 1) : 0,
      days: c,
    })),
  };
}
