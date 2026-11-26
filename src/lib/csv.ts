import { formatTime, slotDayKey } from "./slots";
import type { Entry } from "./types";

const cell = (v: string | number | boolean) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV of entries (in the given order) with both UTC and local (timezone) times.
 * `date` is the day the entry belongs to: a night entry counts toward the day it ends (wake day).
 */
export function entriesToCsv(entries: Entry[], timeZone: string): string {
  const header = ["date", "start", "end", "type", "kicks", "rolls", "other", "skipped", "slot_start_utc", "slot_end_utc", "updated_at"];
  const rows = entries.map((e) => [
    slotDayKey({ start: e.slotStart, end: e.slotEnd, isSleep: e.isSleep }, timeZone),
    formatTime(e.slotStart, timeZone),
    formatTime(e.slotEnd, timeZone),
    e.isSleep ? "night" : "hour",
    e.kicks,
    e.rolls,
    e.other,
    e.skipped,
    e.slotStart,
    e.slotEnd,
    e.updatedAt,
  ]);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
