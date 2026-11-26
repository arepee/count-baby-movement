// Client-side Web Push helpers. Permission must only be requested from a user
// gesture (call subscribe() from a click handler).

import { api } from "./api";

export type PushStatus =
  | "unsupported" // browser has no Push API
  | "needs-install" // iOS Safari tab: must Add to Home Screen first
  | "denied" // permission blocked
  | "subscribed"
  | "not-subscribed";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac; detect via touch support.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches)
  );
}

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function vapidKey(): string | undefined {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined;
}

/**
 * True if `sub` was created with the current VAPID public key. A subscription
 * made with an old key can never receive pushes signed with the new one, so it
 * must be replaced. If the browser doesn't expose the key we assume it matches.
 */
function subscriptionMatchesKey(sub: PushSubscription, key: string): boolean {
  const existing = sub.options?.applicationServerKey;
  if (!existing) return true;
  const a = new Uint8Array(existing);
  let b: Uint8Array;
  try {
    b = urlBase64ToUint8Array(key);
  } catch {
    return true;
  }
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Drop a stale subscription locally and (best effort) on the server. */
async function discardSubscription(sub: PushSubscription): Promise<void> {
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    // ignore
  }
  await api("/api/push/unsubscribe", { method: "POST", body: { endpoint } }).catch(() => {});
}

/** Current subscription, replacing it if it was made with a different VAPID key. */
async function subscribeWithCurrentKey(
  reg: ServiceWorkerRegistration,
  key: string,
): Promise<PushSubscription> {
  let sub = await reg.pushManager.getSubscription();
  if (sub && !subscriptionMatchesKey(sub, key)) {
    await discardSubscription(sub);
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  return sub;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!("serviceWorker" in navigator)) return undefined;
  return navigator.serviceWorker.getRegistration("/");
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await getRegistration();
  if (!existing) await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function getSubscriptionStatus(): Promise<PushStatus> {
  if (!isPushSupported()) {
    return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const key = vapidKey();
    if (
      sub &&
      Notification.permission === "granted" &&
      (!key || subscriptionMatchesKey(sub, key))
    ) {
      return "subscribed";
    }
  } catch {
    // fall through
  }
  return "not-subscribed";
}

export async function subscribe(): Promise<void> {
  if (!isPushSupported()) throw new Error("Push notifications aren't supported here.");
  const key = vapidKey();
  if (!key) throw new Error("Server is missing NEXT_PUBLIC_VAPID_PUBLIC_KEY.");

  // Request permission directly in the user gesture before any long awaits.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked. Enable them in system settings."
        : "Notification permission was not granted.",
    );
  }

  const reg = await ensureRegistration();
  const sub = await subscribeWithCurrentKey(reg, key);
  await api("/api/push/subscribe", { method: "POST", body: sub.toJSON() });
}

export async function unsubscribe(): Promise<void> {
  const reg = await getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const endpoint = sub.endpoint;
  let localError: unknown = null;
  try {
    await sub.unsubscribe();
  } catch (e) {
    localError = e;
  }
  await api("/api/push/unsubscribe", { method: "POST", body: { endpoint } });
  if (localError) throw localError;
}

/**
 * Re-send an existing subscription to the server (upsert), e.g. after a DB
 * reset. If it was created with an old VAPID key, replace it. Only runs when
 * permission is already granted, so it never prompts without a user gesture.
 */
export async function resyncSubscription(): Promise<void> {
  if (!isPushSupported() || Notification.permission !== "granted") return;
  const reg = await getRegistration();
  if (!reg) return;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) return; // never subscribed on this device (or user disabled it)
  const key = vapidKey();
  if (key && !subscriptionMatchesKey(sub, key)) {
    // If this fails (e.g. browser wants a gesture), the device simply shows as
    // "not subscribed" and the Enable prompt reappears — no silent failure.
    try {
      sub = await subscribeWithCurrentKey(reg, key);
    } finally {
      notifyPushChanged();
    }
  }
  await api("/api/push/subscribe", { method: "POST", body: sub.toJSON() });
}

export const PUSH_CHANGED_EVENT = "bm-push-changed";

function notifyPushChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
}

/** Best-effort removal of this device's push subscription (used on logout). */
export async function unsubscribeQuietly(timeoutMs = 3000): Promise<void> {
  if (!isPushSupported()) return;
  await Promise.race([
    unsubscribe().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export async function sendTest(): Promise<number> {
  const r = await api<{ sent: number }>("/api/push/test", { method: "POST" });
  return r?.sent ?? 0;
}
