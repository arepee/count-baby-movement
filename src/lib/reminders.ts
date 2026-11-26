// Pure reminder decision logic for /api/cron (see docs/SPEC.md "Reminder logic").

import type { PushPayload, Slot } from "./types";
import { formatTime, formatTimeRange, isInSleepWindow, type SlotSettings } from "./slots";

export const REMIND_AGAIN_MS = 55 * 60_000;

export type ReminderInput = {
  now: Date;
  settings: SlotSettings;
  pending: Slot[]; // oldest first
  lastNotifiedSlot: string | null;
  lastNotifiedAt: string | null;
};

export type ReminderDecision =
  | { notify: false; reason: "sleeping" | "nothing-pending" | "recently-notified" }
  | { notify: true; reason: "new-slot" | "re-remind"; payload: PushPayload; slotStart: string };

const plural = (n: number) => `${n} hour${n === 1 ? "" : "s"}`;
const same = (a: string | null, b: string) => a !== null && new Date(a).getTime() === new Date(b).getTime();

export function decideReminder(input: ReminderInput): ReminderDecision {
  const { now, settings, pending, lastNotifiedSlot, lastNotifiedAt } = input;
  if (isInSleepWindow(now, settings)) return { notify: false, reason: "sleeping" };
  if (pending.length === 0) return { notify: false, reason: "nothing-pending" };

  const latest = pending[pending.length - 1];
  const n = pending.length;
  const tz = settings.timezone;
  const payload = (body: string): PushPayload => ({ title: "Baby Movement", body, url: "/", tag: "bm-reminder" });

  if (!same(lastNotifiedSlot, latest.start)) {
    let body: string;
    if (latest.isSleep && n === 1) body = "Good morning — log movement for the night";
    else if (n === 1) body = `Log baby movement for ${formatTimeRange(latest, tz)}`;
    else body = `${plural(n)} to log, starting ${formatTime(pending[0].start, tz, true)}`;
    if (latest.isSleep && n > 1) body = `Good morning — ${body}`;
    return { notify: true, reason: "new-slot", payload: payload(body), slotStart: latest.start };
  }

  const last = lastNotifiedAt ? new Date(lastNotifiedAt).getTime() : 0;
  if (now.getTime() - last >= REMIND_AGAIN_MS) {
    return { notify: true, reason: "re-remind", payload: payload(`Still waiting: ${plural(n)} to log`), slotStart: latest.start };
  }
  return { notify: false, reason: "recently-notified" };
}
