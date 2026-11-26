// Dependency-free timezone helpers built on Intl. Safe for client and server.

export type LocalDate = { year: number; month: number; day: number }; // month 1-12
export type LocalDateTime = LocalDate & { hour: number; minute: number; second: number };

const MINUTE = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True if `tz` is an IANA zone name Intl understands. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of `ms` in `timeZone`. */
export function toLocal(ms: number, timeZone: string): LocalDateTime {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** UTC offset (ms, local minus UTC) of `timeZone` at instant `ms`. */
export function tzOffset(ms: number, timeZone: string): number {
  const l = toLocal(ms, timeZone);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Convert a local wall-clock time to a UTC instant (ms).
 * Ambiguous times (fall back) resolve to the earlier instant; nonexistent times
 * (spring forward gap) are shifted forward by the gap length (like Temporal "compatible").
 */
export function localToUtc(d: LocalDate, minutesOfDay: number, timeZone: string): number {
  const wall = Date.UTC(d.year, d.month - 1, d.day) + minutesOfDay * MINUTE;
  const o1 = tzOffset(wall, timeZone);
  const r1 = wall - o1;
  const o2 = tzOffset(r1, timeZone);
  if (o1 === o2) {
    // Check for an earlier valid interpretation (ambiguous wall time).
    const o0 = tzOffset(r1 - 3 * 3600_000, timeZone);
    if (o0 !== o1 && tzOffset(wall - o0, timeZone) === o0) return Math.min(r1, wall - o0);
    return r1;
  }
  const r2 = wall - o2;
  return tzOffset(r2, timeZone) === o2 ? r2 : r1;
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Local calendar date of instant `ms` in `timeZone`. */
export function localDate(ms: number, timeZone: string): LocalDate {
  const { year, month, day } = toLocal(ms, timeZone);
  return { year, month, day };
}

/** "YYYY-MM-DD" key of the local date of `instant` (useful for grouping by day). */
export function localDateKey(instant: string | number | Date, timeZone: string): string {
  const d = localDate(new Date(instant).getTime(), timeZone);
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Parse "HH:MM" (00:00–23:59) to minutes of day, or null if invalid. */
export function parseHHMM(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
