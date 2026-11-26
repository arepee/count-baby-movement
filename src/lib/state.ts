// Server-side composition of settings + entries into pending slots.

import { entryRangesBetween, getSettings, type SettingsRecord } from "./db";
import { coveredStarts, pendingSlots, pendingWindowStart } from "./slots";
import type { Slot } from "./types";

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
