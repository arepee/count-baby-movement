"use client";

import { usePush } from "@/client/usePush";

/** Prompt card on the Log screen; renders nothing once subscribed or unsupported. */
export default function NotificationCard() {
  const { status, busy, error, enable } = usePush();

  if (status === null || status === "subscribed" || status === "unsupported") return null;

  if (status === "needs-install") {
    return (
      <div className="card hint">
        <strong>Add to Home Screen first</strong>
        <p className="muted">
          To get hourly reminders on iPhone, tap Share → Add to Home Screen, then open Kicks
          from your home screen.
        </p>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="card hint">
        <strong>Reminders are blocked</strong>
        <p className="muted">Allow notifications for this app in system settings.</p>
      </div>
    );
  }

  return (
    <div className="card hint">
      <strong>Get hourly reminders</strong>
      <p className="muted">We&apos;ll nudge you when an hour is ready to log.</p>
      <button type="button" className="btn primary" disabled={busy} onClick={enable}>
        {busy ? "Enabling…" : "Enable notifications"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
