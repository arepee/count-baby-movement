// Pure reminder decision logic for /api/cron (see docs/SPEC.md "Reminder logic").

import type { Counts, PushPayload, Slot } from "./types";
import { formatTime, formatTimeRange, slotContaining, type SlotSettings } from "./slots";
import { confirmTapsBody } from "./taps";

export const REMIND_AGAIN_MS = 55 * 60_000;
/** Skip a re-remind when the in-progress slot ends this soon: a new-slot push is about to follow. */
export const NEW_SLOT_SOON_MS = 15 * 60_000;

export type ReminderInput = {
  now: Date;
  settings: SlotSettings;
  pending: Slot[]; // oldest first
  lastNotifiedSlot: string | null;
  lastNotifiedAt: string | null;
  /** Tap counts keyed by pending slot start (live taps, v3); only the latest slot's is used. */
  prefill?: Record<string, Counts>;
};

export type ReminderDecision =
  | { notify: false; reason: "sleeping" | "nothing-pending" | "recently-notified" | "new-slot-soon" }
  | { notify: true; reason: "new-slot" | "re-remind"; payload: PushPayload; slotStart: string };

const plural = (n: number) => `${n} hour${n === 1 ? "" : "s"}`;
const same = (a: string | null, b: string) => a !== null && new Date(a).getTime() === new Date(b).getTime();

export function decideReminder(input: ReminderInput): ReminderDecision {
  const { now, settings, pending, lastNotifiedSlot, lastNotifiedAt, prefill } = input;
  const current = slotContaining(now, settings);
  if (current.isSleep) return { notify: false, reason: "sleeping" };
  if (pending.length === 0) return { notify: false, reason: "nothing-pending" };

  const latest = pending[pending.length - 1];
  const n = pending.length;
  const tz = settings.timezone;
  const payload = (body: string): PushPayload => ({ title: "Baby Movement", body, url: "/", tag: "bm-reminder" });

  if (!same(lastNotifiedSlot, latest.start)) {
    let body: string;
    const confirm = n === 1 ? confirmTapsBody(latest, prefill?.[latest.start], tz) : null;
    if (confirm) body = confirm;
    else if (latest.isSleep && n === 1) body = "Good morning — log movement for the night";
    else if (n === 1) body = `Log baby movement for ${formatTimeRange(latest, tz)}`;
    else body = `${plural(n)} to log, starting ${formatTime(pending[0].start, tz, true)}`;
    if (latest.isSleep && n > 1) body = `Good morning — ${body}`;
    return { notify: true, reason: "new-slot", payload: payload(body), slotStart: latest.start };
  }

  const last = lastNotifiedAt ? new Date(lastNotifiedAt).getTime() : 0;
  if (now.getTime() - last < REMIND_AGAIN_MS) return { notify: false, reason: "recently-notified" };

  // The in-progress slot is about to end, and the next cron run will then send a
  // new-slot push; re-reminding now would buzz twice within minutes. (Exception: if
  // the sleep window follows, no new-slot push comes until morning, so remind now.)
  const endsIn = new Date(current.end).getTime() - now.getTime();
  const next = slotContaining(current.end, settings);
  if (endsIn <= NEW_SLOT_SOON_MS && !next.isSleep) return { notify: false, reason: "new-slot-soon" };

  return { notify: true, reason: "re-remind", payload: payload(`Still waiting: ${plural(n)} to log`), slotStart: latest.start };
}
