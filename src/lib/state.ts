// Server-side composition of settings + entries (+ live taps) into pending slots.

import { entryRangesBetween, getSettings, lastTap, tapsBetween, type SettingsRecord } from "./db";
import { coveredStarts, pendingSlots, pendingWindowStart, slotContaining } from "./slots";
import { buildTapState, countTapsBySlot, localMidnight, zeroCounts } from "./taps";
import type { Counts, Slot, Tap } from "./types";

/**
 * Settings plus pending slots. Before first-run setup (settings.initialized false)
 * nothing is pending: tracking_start is just whenever the row happened to be created.
 */
export async function loadPending(now: Date): Promise<{ settings: SettingsRecord; pending: Slot[] }> {
  const settings = await getSettings();
  if (!settings.initialized) return { settings, pending: [] };
  const from = pendingWindowStart(now, settings);
  // Only entries overlapping the pending window matter (not the whole history).
  const covered = coveredStarts(await entryRangesBetween(from, now.toISOString()), settings);
  return { settings, pending: pendingSlots(now, settings, covered) };
}

const tapFloor = (s: SettingsRecord) => (s.initialized ? s.trackingStart : null);

/** Tap counts for the given (pending) slots, keyed by slot start; only slots with taps. */
export async function loadPrefill(slots: Slot[], settings: SettingsRecord): Promise<Record<string, Counts>> {
  if (slots.length === 0) return {};
  const taps = await tapsBetween(slots[0].start, slots[slots.length - 1].end);
  return countTapsBySlot(taps, slots, new Set(), tapFloor(settings));
}

/** Tap counts for the in-progress slot (zeros if that slot already has an entry). */
export async function loadLive(now: Date, settings: SettingsRecord): Promise<Counts> {
  const current = slotContaining(now, settings);
  const [taps, ranges] = await Promise.all([
    tapsBetween(current.start, current.end),
    entryRangesBetween(current.start, current.end),
  ]);
  const covered = coveredStarts(ranges, settings);
  return countTapsBySlot(taps, [current], covered, tapFloor(settings))[current.start] ?? zeroCounts();
}

/** Everything GET /api/state needs apart from `recent`. */
export async function loadState(now: Date): Promise<{
  settings: SettingsRecord;
  pending: Slot[];
  current: Slot;
  live: Counts;
  lastTap: Tap | null;
  todayTaps: Tap[];
  prefill: Record<string, Counts>;
}> {
  const settings = await getSettings();
  const current = slotContaining(now, settings);
  const midnight = localMidnight(now, settings.timezone);
  const windowStart = settings.initialized ? new Date(pendingWindowStart(now, settings)).getTime() : Infinity;
  // One bounded range covers the pending window, today (for todayTaps) and the current slot.
  const from = new Date(Math.min(windowStart, midnight, new Date(current.start).getTime())).toISOString();
  const [ranges, taps, last] = await Promise.all([entryRangesBetween(from, now.toISOString()), tapsBetween(from), lastTap()]);
  const covered = coveredStarts(ranges, settings);
  const pending = settings.initialized ? pendingSlots(now, settings, covered) : [];
  return { settings, pending, current, lastTap: last, ...buildTapState({ now, settings, current, pending, taps, covered }) };
}
