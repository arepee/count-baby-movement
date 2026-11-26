import { setLastNotified } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { sendToAll } from "@/lib/push";
import { decideReminder } from "@/lib/reminders";
import { safeEqual } from "@/lib/session";
import { loadPending } from "@/lib/state";
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
  const decision = decideReminder({
    now,
    settings,
    pending,
    lastNotifiedSlot: settings.lastNotifiedSlot,
    lastNotifiedAt: settings.lastNotifiedAt,
  });
  if (decision.notify) {
    await sendToAll(decision.payload);
    await setLastNotified(decision.slotStart, now);
  }
  return json<CronResponse>({ notified: decision.notify, reason: decision.reason, pending: pending.length });
}

export const GET = handle(run);
export const POST = handle(run);
