import { setLastNotified } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { PushNotConfiguredError, sendToAll } from "@/lib/push";
import { decideReminder } from "@/lib/reminders";
import { safeEqual } from "@/lib/session";
import { loadPending, loadPrefill } from "@/lib/state";
import type { CronResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function run(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "CRON_SECRET is not configured" }, 500);
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const now = new Date();
  const { settings, pending } = await loadPending(now);
  // Until the app has been opened once (POST /api/setup), tracking_start/timezone are
  // placeholders: don't notify about a backlog that was never meant to be tracked.
  if (!settings.initialized) return json<CronResponse>({ notified: false, reason: "not-set-up", pending: 0 });

  const decision = decideReminder({
    now,
    settings,
    pending,
    lastNotifiedSlot: settings.lastNotifiedSlot,
    lastNotifiedAt: settings.lastNotifiedAt,
    // Only the latest pending slot's taps can change the text ("Confirm 3 kicks for ...").
    prefill: pending.length > 0 ? await loadPrefill(pending.slice(-1), settings) : {},
  });
  if (!decision.notify) return json<CronResponse>({ notified: false, reason: decision.reason, pending: pending.length });

  // Push problems are reported in the (200) response and logs rather than as a 500,
  // so the scheduler doesn't retry and nothing is double-sent.
  let r;
  try {
    r = await sendToAll(decision.payload);
  } catch (err) {
    if (!(err instanceof PushNotConfiguredError)) throw err;
    console.error("cron:", err.message);
    return json<CronResponse>({ notified: false, reason: "push-not-configured", pending: pending.length, error: err.message });
  }
  // Mark the slot as notified unless every delivery failed (then the next run retries,
  // 30 minutes later). With no subscriptions there's nothing to retry.
  const allFailed = r.failed > 0 && r.sent === 0;
  if (!allFailed) await setLastNotified(decision.slotStart, now);
  return json<CronResponse>({
    notified: r.sent > 0,
    reason: allFailed ? "push-failed" : decision.reason,
    pending: pending.length,
    ...r,
  });
}

export const GET = handle(run);
export const POST = handle(run);
