// Server-side Web Push delivery.
//
// web-push 4.x is an ES module with named exports only (no default export), so a
// default import is undefined at runtime even though the stale v3 @types accept it.

import { sendNotification, setVapidDetails } from "web-push";
import { deleteSubscription, listSubscriptions } from "./db";
import type { PushPayload } from "./types";

export class PushNotConfiguredError extends Error {
  constructor() {
    super("Push is not configured: set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY");
    this.name = "PushNotConfiguredError";
  }
}

let configuredWith: string | null = null;

/** Apply the VAPID env vars. Throws PushNotConfiguredError if they're missing (or invalid). */
function configure() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new PushNotConfiguredError();
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  const key = `${subject}|${pub}|${priv}`;
  if (configuredWith === key) return;
  try {
    setVapidDetails(subject, pub, priv);
  } catch (err) {
    console.error("invalid VAPID details:", (err as Error).message);
    throw new PushNotConfiguredError();
  }
  configuredWith = key;
}

export type SendResult = { sent: number; removed: number; failed: number };

/**
 * Send `payload` to every enabled subscription. Subscriptions the push service
 * reports gone (404/410) are deleted; other failures are counted and logged.
 * Throws PushNotConfiguredError when VAPID keys are missing.
 */
export async function sendToAll(payload: PushPayload): Promise<SendResult> {
  configure();
  const subs = await listSubscriptions();
  const body = JSON.stringify(payload);
  const result: SendResult = { sent: 0, removed: 0, failed: 0 };
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 3600,
          urgency: "high",
          timeout: 10_000,
        });
        result.sent++;
      } catch (err) {
        const e = err as { statusCode?: number; body?: unknown; message?: string };
        const host = safeHost(s.endpoint);
        if (e.statusCode === 404 || e.statusCode === 410) {
          try {
            await deleteSubscription(s.endpoint);
            result.removed++;
          } catch (delErr) {
            result.failed++;
            console.error("push: failed to delete expired subscription", host, (delErr as Error).message);
          }
          return;
        }
        result.failed++;
        // 403 from Apple (BadJwtToken / VAPID key mismatch) usually means the VAPID keys
        // changed since the device subscribed: the device has to re-enable notifications.
        console.error("push failed", host, e.statusCode ?? "-", e.message ?? String(err), e.body ? String(e.body).slice(0, 300) : "");
      }
    }),
  );
  return result;
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "?";
  }
}
