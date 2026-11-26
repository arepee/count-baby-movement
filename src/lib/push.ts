// Server-side Web Push delivery.

import webpush from "web-push";
import { deleteSubscription, listSubscriptions } from "./db";
import type { PushPayload } from "./types";

let configured = false;

function configure() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("VAPID keys are not configured");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
  configured = true;
}

/** Send `payload` to every enabled subscription; drop ones the push service reports gone (404/410). */
export async function sendToAll(payload: PushPayload): Promise<{ sent: number; removed: number; failed: number }> {
  configure();
  const subs = await listSubscriptions();
  const body = JSON.stringify(payload);
  let sent = 0, removed = 0, failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600, urgency: "high" });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deleteSubscription(s.endpoint);
          removed++;
        } else {
          failed++;
          console.error("push failed", status, (err as Error).message);
        }
      }
    }),
  );
  return { sent, removed, failed };
}
