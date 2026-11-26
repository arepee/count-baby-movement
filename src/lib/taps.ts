// Pure live-tap logic (see docs/SPEC.md "Live taps (v3)"). Safe for client and server.
//
// Taps are drafts: they prefill the steppers of an hour once it has ended, and are
// ignored for any slot that already has a confirmed entry. A slot "has an entry" when
// its start is in coveredStarts() (an entry covers every slot it overlaps), so taps
// stay consistent with the pending computation even after a sleep-window change.

import type { Counts, Settings, Slot, Tap, TapKind } from "./types";
import { formatTimeRange, slotContaining, type SlotSettings } from "./slots";
import { localDate, localToUtc } from "./tz";

export const TAP_KINDS: readonly TapKind[] = ["kick", "roll", "other"];
export const MAX_TODAY_TAPS = 200;

export const isTapKind = (v: unknown): v is TapKind => typeof v === "string" && (TAP_KINDS as readonly string[]).includes(v);

const FIELD: Record<TapKind, keyof Counts> = { kick: "kicks", roll: "rolls", other: "other" };
const ms = (t: string | number | Date) => (typeof t === "number" ? t : new Date(t).getTime());

export const zeroCounts = (): Counts => ({ kicks: 0, rolls: 0, other: 0 });
export const countsTotal = (c: Counts): number => c.kicks + c.rolls + c.other;

/** Count taps by kind. */
export function countTaps(taps: Pick<Tap, "kind">[]): Counts {
  const c = zeroCounts();
  for (const t of taps) c[FIELD[t.kind]]++;
  return c;
}

/**
 * Per-slot tap counts: for each slot, the taps with `at` in [start, end). Slots whose
 * start is in `covered` (already have an entry) are left out, as are slots with no
 * taps, and taps before `notBefore` (tracking start) are ignored. Keys are slot starts.
 */
export function countTapsBySlot(
  taps: Pick<Tap, "at" | "kind">[],
  slots: Slot[],
  covered: Set<string> = new Set(),
  notBefore: string | null = null,
): Record<string, Counts> {
  const min = notBefore ? ms(notBefore) : -Infinity;
  const out: Record<string, Counts> = {};
  for (const slot of slots) {
    if (covered.has(slot.start)) continue;
    const a = ms(slot.start);
    const b = ms(slot.end);
    const inSlot = taps.filter((t) => {
      const x = ms(t.at);
      return x >= a && x < b && x >= min;
    });
    if (inSlot.length > 0) out[slot.start] = countTaps(inSlot);
  }
  return out;
}

/** UTC instant of local midnight (start of the local day containing `now`) in `timeZone`. */
export function localMidnight(now: string | number | Date, timeZone: string): number {
  return localToUtc(localDate(ms(now), timeZone), 0, timeZone);
}

export type TapStateInput = {
  now: Date;
  settings: SlotSettings & Pick<Settings, "trackingStart" | "initialized">;
  current: Slot;
  pending: Slot[];
  taps: Tap[]; // every tap since min(pending window start, local midnight, current.start), any order
  covered: Set<string>; // slot starts (current settings) that already have an entry
};

/**
 * live / todayTaps / prefill for GET /api/state. Taps in slots that already have an
 * entry are dropped everywhere; taps before tracking start (once set up) never count
 * towards live or prefill.
 */
export function buildTapState(input: TapStateInput): { live: Counts; todayTaps: Tap[]; prefill: Record<string, Counts> } {
  const { now, settings, current, pending, taps, covered } = input;
  const notBefore = settings.initialized ? settings.trackingStart : null;
  const live = countTapsBySlot(taps, [current], covered, notBefore)[current.start] ?? zeroCounts();
  const prefill = countTapsBySlot(taps, pending, covered, notBefore);
  const midnight = localMidnight(now, settings.timezone);
  const todayTaps = taps
    .filter((t) => ms(t.at) >= midnight && !covered.has(slotContaining(t.at, settings).start))
    .sort((a, b) => ms(b.at) - ms(a.at) || b.id - a.id)
    .slice(0, MAX_TODAY_TAPS);
  return { live, todayTaps, prefill };
}

const KIND_WORDS: [keyof Counts, string, string][] = [
  ["kicks", "kick", "kicks"],
  ["rolls", "roll", "rolls"],
  ["other", "other", "other"],
];

/** "3 kicks, 1 roll" (zero kinds omitted); "" when there are no taps. */
export function formatCounts(c: Counts): string {
  return KIND_WORDS.filter(([k]) => c[k] > 0)
    .map(([k, one, many]) => `${c[k]} ${c[k] === 1 ? one : many}`)
    .join(", ");
}

/**
 * Reminder body asking to confirm a slot's taps: "Confirm 3 kicks, 1 roll for
 * 2:30–3:30 PM", or "Confirm the night: 5 kicks" for the sleep slot. Null when the
 * slot has no taps (callers then use the plain text).
 */
export function confirmTapsBody(slot: Slot, counts: Counts | undefined, timeZone: string): string | null {
  if (!counts || countsTotal(counts) === 0) return null;
  const what = formatCounts(counts);
  return slot.isSleep ? `Confirm the night: ${what}` : `Confirm ${what} for ${formatTimeRange(slot, timeZone)}`;
}
