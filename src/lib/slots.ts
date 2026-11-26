// Pure slot logic (see docs/SPEC.md "Slots"). Safe for client and server.
//
// Time is split into "cycles", one per local date D: a cycle starts at the wake
// time W(D) (= sleepEnd on date D) and ends at W(D+1). Inside a cycle, awake
// slots run in 1-hour steps of real elapsed time from W(D) up to the sleep
// start S (last one truncated), then one sleep slot runs [S, W(D+1)). If
// sleepStart == sleepEnd there is no sleep slot and hourly slots fill the cycle
// (last one truncated on a 23h DST day). Because cycles are contiguous and each
// cycle is tiled exactly, slots never overlap or leave gaps, even across DST.

import type { Settings, Slot } from "./types";
import { addDays, localDate, localDateKey, localToUtc, parseHHMM, type LocalDate } from "./tz";

export type SlotSettings = Pick<Settings, "sleepStart" | "sleepEnd" | "timezone">;

const HOUR = 3_600_000;
export const MAX_PENDING = 72;

type Ms = number | string | Date;
const toMs = (t: Ms): number => (typeof t === "number" ? t : new Date(t).getTime());
const iso = (ms: number) => new Date(ms).toISOString();

function minutes(s: SlotSettings): { wake: number; sleep: number } {
  const wake = parseHHMM(s.sleepEnd);
  const sleep = parseHHMM(s.sleepStart);
  if (wake === null || sleep === null) throw new Error("Invalid sleep window (expected HH:MM)");
  return { wake, sleep };
}

const wakeAt = (d: LocalDate, s: SlotSettings) => localToUtc(d, minutes(s).wake, s.timezone);

/** All slots of the cycle that starts at the wake time on local date `d`. */
function cycleSlots(d: LocalDate, s: SlotSettings): Slot[] {
  const { wake, sleep } = minutes(s);
  const start = localToUtc(d, wake, s.timezone);
  const end = localToUtc(addDays(d, 1), wake, s.timezone);
  let awakeEnd = end;
  if (sleep !== wake) {
    // Sleep start falls on the same date if it is later in the day than wake, else the next date.
    awakeEnd = Math.min(end, localToUtc(sleep > wake ? d : addDays(d, 1), sleep, s.timezone));
  }
  const out: Slot[] = [];
  for (let t = start; t < awakeEnd; t += HOUR) {
    out.push({ start: iso(t), end: iso(Math.min(t + HOUR, awakeEnd)), isSleep: false });
  }
  if (awakeEnd < end) out.push({ start: iso(awakeEnd), end: iso(end), isSleep: true });
  return out;
}

/** Local date of the cycle containing instant `ms`. */
function cycleDate(ms: number, s: SlotSettings): LocalDate {
  const d = localDate(ms, s.timezone);
  return ms >= wakeAt(d, s) ? d : addDays(d, -1);
}

/** The slot containing `instant` (start <= instant < end). */
export function slotContaining(instant: Ms, s: SlotSettings): Slot {
  const ms = toMs(instant);
  if (Number.isNaN(ms)) throw new Error("Invalid instant");
  const slots = cycleSlots(cycleDate(ms, s), s);
  return slots.find((x) => toMs(x.end) > ms) ?? slots[slots.length - 1];
}

/**
 * Slots overlapping [from, to), oldest first: begins with the slot containing
 * `from` and includes every slot whose start is before `to`.
 */
export function slotsBetween(from: Ms, to: Ms, s: SlotSettings): Slot[] {
  const fromMs = toMs(from);
  const toMsV = toMs(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMsV)) throw new Error("Invalid range");
  const out: Slot[] = [];
  for (let d = cycleDate(fromMs, s); ; d = addDays(d, 1)) {
    for (const slot of cycleSlots(d, s)) {
      const st = toMs(slot.start);
      if (st >= toMsV) return out;
      if (toMs(slot.end) > fromMs) out.push(slot);
    }
  }
}

/** True if `value` is exactly the start of a slot under these settings. */
export function isValidSlotStart(value: string, s: SlotSettings): boolean {
  const ms = toMs(value);
  return !Number.isNaN(ms) && toMs(slotContaining(ms, s).start) === ms;
}

/** True if `instant` falls inside the sleep window (i.e. within the sleep slot). */
export function isInSleepWindow(instant: Ms, s: SlotSettings): boolean {
  return slotContaining(instant, s).isSleep;
}

/** Normalise an instant to the canonical ISO string used as a slot key. */
export const slotKey = (t: Ms): string => iso(toMs(t));

/**
 * Slot starts (under the current settings) covered by the given entries. An
 * entry covers every slot it overlaps, so entries recorded under an older sleep
 * window don't make the realigned slots show up as pending.
 */
export function coveredStarts(
  entries: { slotStart: Ms; slotEnd: Ms }[],
  s: SlotSettings,
): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    for (const slot of slotsBetween(e.slotStart, e.slotEnd, s)) out.add(slot.start);
  }
  return out;
}

/**
 * Start of the MAX_PENDING-th most recent ended slot (end <= now), counting every
 * slot whether logged or not. Nothing older than this is ever pending, so clearing
 * the backlog can't make older slots resurface.
 */
export function pendingCutoff(now: Ms, s: SlotSettings): string {
  const nowMs = toMs(now);
  if (Number.isNaN(nowMs)) throw new Error("Invalid instant");
  const ended: Slot[] = []; // newest first
  for (let d = cycleDate(nowMs, s); ended.length < MAX_PENDING; d = addDays(d, -1)) {
    const slots = cycleSlots(d, s);
    for (let i = slots.length - 1; i >= 0 && ended.length < MAX_PENDING; i--) {
      if (toMs(slots[i].end) <= nowMs) ended.push(slots[i]);
    }
  }
  return ended[ended.length - 1].start;
}

/**
 * Earliest slot start that can be pending: the later of pendingCutoff() and the
 * slot containing trackingStart. Entries overlapping [this, now) are all that the
 * pending computation needs.
 */
export function pendingWindowStart(now: Ms, s: SlotSettings & Pick<Settings, "trackingStart">): string {
  const cutoff = pendingCutoff(now, s);
  const tracking = slotContaining(s.trackingStart, s).start;
  return toMs(tracking) > toMs(cutoff) ? tracking : cutoff;
}

/**
 * Ended slots (end <= now) without an entry whose start is >= pendingWindowStart(),
 * oldest first. At most MAX_PENDING by construction.
 */
export function pendingSlots(
  now: Ms,
  s: SlotSettings & Pick<Settings, "trackingStart">,
  enteredStarts: Set<string>,
): Slot[] {
  const nowMs = toMs(now);
  const entered = new Set([...enteredStarts].map(slotKey));
  const from = pendingWindowStart(nowMs, s);
  if (toMs(from) >= nowMs) return [];
  return slotsBetween(from, nowMs, s).filter((x) => toMs(x.end) <= nowMs && !entered.has(x.start));
}

/**
 * "YYYY-MM-DD" local day a slot belongs to for day grouping (history, CSV): awake
 * slots belong to the day they start, a night slot to the day it ENDS (the wake day).
 */
export function slotDayKey(slot: { start: Ms; end: Ms; isSleep: boolean }, timeZone: string): string {
  return localDateKey(toMs(slot.isSleep ? slot.end : slot.start), timeZone);
}

// ---------- Formatting (client-safe) ----------

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string, weekday: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${weekday}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      ...(weekday ? { weekday: "short" } : {}),
    });
    fmtCache.set(key, f);
  }
  return f;
}

/** "2:30 PM" (or "Thu 2:30 PM" with weekday). Normalises ICU's narrow no-break space. */
export function formatTime(t: Ms, timeZone: string, weekday = false): string {
  return fmt(timeZone, weekday)
    .format(new Date(toMs(t)))
    .replace(/[  ]/g, " ")
    .replace(",", "");
}

/** "Thu 2:30 PM – 3:30 PM", or "Night · 11:30 PM – 7:30 AM" for the sleep slot. */
export function formatSlotLabel(slot: Slot, timeZone: string): string {
  const end = formatTime(slot.end, timeZone);
  return slot.isSleep
    ? `Night · ${formatTime(slot.start, timeZone)} – ${end}`
    : `${formatTime(slot.start, timeZone, true)} – ${end}`;
}

/** Compact range: "2:30–3:30 PM", or "11:30 AM–12:30 PM" when the meridiem differs. */
export function formatTimeRange(slot: Slot, timeZone: string): string {
  const a = formatTime(slot.start, timeZone);
  const b = formatTime(slot.end, timeZone);
  const [ta, ma] = a.split(" ");
  const [, mb] = b.split(" ");
  return ma === mb ? `${ta}–${b}` : `${a}–${b}`;
}
