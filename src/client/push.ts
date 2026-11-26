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
    if (sub && Notification.permission === "granted") return "subscribed";
  } catch {
    // fall through
  }
  return "not-subscribed";
}

export async function subscribe(): Promise<void> {
  if (!isPushSupported()) throw new Error("Push notifications aren't supported here.");
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
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
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await api("/api/push/subscribe", { method: "POST", body: sub.toJSON() });
}

export async function unsubscribe(): Promise<void> {
  const reg = await getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api("/api/push/unsubscribe", { method: "POST", body: { endpoint } });
}

/** Re-send an existing subscription to the server (upsert), e.g. after a DB reset. */
export async function resyncSubscription(): Promise<void> {
  if (!isPushSupported() || Notification.permission !== "granted") return;
  const reg = await getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) await api("/api/push/subscribe", { method: "POST", body: sub.toJSON() });
}

export async function sendTest(): Promise<number> {
  const r = await api<{ sent: number }>("/api/push/test", { method: "POST" });
  return r?.sent ?? 0;
}
