// Server-side composition of settings + entries into pending slots.

import { entryRangesSince, getSettings, type SettingsRecord } from "./db";
import { coveredStarts, pendingSlots, slotContaining } from "./slots";
import type { Slot } from "./types";

export async function loadPending(now: Date): Promise<{ settings: SettingsRecord; pending: Slot[] }> {
  const settings = await getSettings();
  const from = slotContaining(settings.trackingStart, settings).start;
  const covered = coveredStarts(await entryRangesSince(from), settings);
  return { settings, pending: pendingSlots(now, settings, covered) };
}
