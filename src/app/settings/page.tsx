"use client";

import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/client/api";
import { deviceTimezone, sameTimezone } from "@/client/format";
import { sendTest, unsubscribeQuietly } from "@/client/push";
import { usePush } from "@/client/usePush";
import type { Settings } from "@/client/types";

function supportedTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] };
  try {
    return intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
}

export default function SettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [sleepStart, setSleepStart] = useState("23:30");
  const [sleepEnd, setSleepEnd] = useState("07:30");
  const [timezone, setTimezone] = useState("");
  const [dueDate, setDueDate] = useState(""); // "YYYY-MM-DD" or "" for none
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [zones, setZones] = useState<string[]>([]);

  useEffect(() => {
    setZones(supportedTimezones());
    (async () => {
      try {
        const r = await api<{ settings: Settings }>("/api/settings");
        setSleepStart(r.settings.sleepStart);
        setSleepEnd(r.settings.sleepEnd);
        setTimezone(r.settings.timezone || deviceTimezone());
        setDueDate(r.settings.dueDate ?? "");
        setLoaded(true);
      } catch (e) {
        setMsg({ ok: false, text: errorMessage(e) });
      }
    })();
  }, []);

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const r = await api<{ settings: Settings }>("/api/settings", {
        method: "PUT",
        body: { sleepStart, sleepEnd, timezone: timezone.trim(), dueDate: dueDate || null },
      });
      setSleepStart(r.settings.sleepStart);
      setSleepEnd(r.settings.sleepEnd);
      setTimezone(r.settings.timezone);
      setDueDate(r.settings.dueDate ?? "");
      setMsg({ ok: true, text: "Saved" });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const devTz = useMemo(() => (loaded ? deviceTimezone() : ""), [loaded]);

  return (
    <>
      <h1>Settings</h1>

      <form className="card" onSubmit={save}>
        <h2>Sleep window</h2>
        <p className="muted small">The whole sleep window is logged as one entry.</p>
        <div className="row-2">
          <div className="field">
            <label htmlFor="sleepStart">Sleep starts</label>
            <input
              id="sleepStart"
              className="input"
              type="time"
              required
              value={sleepStart}
              disabled={!loaded}
              onChange={(e) => setSleepStart(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sleepEnd">Wake up</label>
            <input
              id="sleepEnd"
              className="input"
              type="time"
              required
              value={sleepEnd}
              disabled={!loaded}
              onChange={(e) => setSleepEnd(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="tz">Timezone</label>
          <input
            id="tz"
            className="input"
            type="text"
            list="tz-list"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={timezone}
            disabled={!loaded}
            onChange={(e) => setTimezone(e.target.value)}
          />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          {loaded && devTz && !sameTimezone(devTz, timezone) && (
            <button type="button" className="btn" onClick={() => setTimezone(devTz)}>
              Use this device&apos;s timezone ({devTz})
            </button>
          )}
        </div>

        <div className="field">
          <label htmlFor="dueDate">Due date (optional)</label>
          <div className="date-row">
            <input
              id="dueDate"
              className="input"
              type="date"
              value={dueDate}
              disabled={!loaded}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={!loaded || !dueDate}
              onClick={() => setDueDate("")}
            >
              Clear
            </button>
          </div>
          <p className="muted small">Shows the pregnancy week on Insights and the doctor summary.</p>
        </div>

        <button type="submit" className="btn primary block" disabled={!loaded || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
      </form>

      <RestartSection
        timezone={timezone.trim()}
        disabled={!loaded || saving}
        onDone={(st) => {
          setSleepStart(st.sleepStart);
          setSleepEnd(st.sleepEnd);
          setTimezone(st.timezone);
          setDueDate(st.dueDate ?? "");
          setMsg(null);
        }}
      />

      <NotificationsSection />

      <LogoutSection />

      <ResetSection />
    </>
  );
}

function RestartSection({
  timezone,
  disabled,
  onDone,
}: {
  timezone: string;
  disabled: boolean;
  onDone: (s: Settings) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const restart = async () => {
    const ok = window.confirm(
      `Restart tracking from now${timezone ? ` (timezone ${timezone})` : ""}?\n\n` +
        "Hours before now that haven't been logged will be dropped and you won't be asked " +
        "about them. Entries you've already saved are kept.",
    );
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ settings: Settings }>("/api/setup", {
        method: "POST",
        body: { timezone },
      });
      onDone(r.settings);
      setMsg({ ok: true, text: "Tracking restarted from now" });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Tracking</h2>
      <p className="muted small">
        Restart if you&apos;ve been away: older unlogged hours are dropped so you only log from
        now on. Uses the timezone selected above.
      </p>
      <button type="button" className="btn block" disabled={disabled || busy} onClick={restart}>
        {busy ? "Restarting…" : "Restart tracking from now"}
      </button>
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
    </section>
  );
}

function NotificationsSection() {
  const { status, busy, error, enable, disable } = usePush();
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const test = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const n = await sendTest();
      setTestMsg({
        ok: n > 0,
        text: n > 0 ? `Sent to ${n} device${n === 1 ? "" : "s"}` : "No subscribed devices",
      });
    } catch (e) {
      setTestMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  const statusText: Record<string, string> = {
    subscribed: "On for this device",
    "not-subscribed": "Off for this device",
    denied: "Blocked — allow notifications in system settings",
    unsupported: "Not supported in this browser",
    "needs-install": "Add to Home Screen first, then open the app from there",
  };

  return (
    <section className="card">
      <h2>Notifications</h2>
      <p className={status === "subscribed" ? "" : "muted"}>
        {status === null ? "Checking…" : statusText[status]}
      </p>
      {status === "not-subscribed" && (
        <button type="button" className="btn primary block" disabled={busy} onClick={enable}>
          {busy ? "Enabling…" : "Enable"}
        </button>
      )}
      {status === "subscribed" && (
        <button type="button" className="btn block" disabled={busy} onClick={disable}>
          {busy ? "Disabling…" : "Disable"}
        </button>
      )}
      <button type="button" className="btn block" disabled={testing} onClick={test}>
        {testing ? "Sending…" : "Send test"}
      </button>
      {error && <p className="error">{error}</p>}
      {testMsg && <p className={testMsg.ok ? "success" : "error"}>{testMsg.text}</p>}
    </section>
  );
}

function LogoutSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logout = async () => {
    setBusy(true);
    setError(null);
    try {
      // Stop reminders on this device first (needs the session for the API call).
      await unsubscribeQuietly();
      await api("/api/logout", { method: "POST" });
      window.location.replace("/login");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <button type="button" className="btn danger block" disabled={busy} onClick={logout}>
        {busy ? "Logging out…" : "Log out"}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/**
 * Laptop-only (CSS: .desktop-only) "erase all data" with two confirmations.
 * Step 1 explains; step 2 needs the word RESET typed. The final action downloads
 * a CSV backup first and only erases once the backup has downloaded.
 */
function ResetSection() {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const cancel = () => {
    setStep(0);
    setPhrase("");
  };

  const eraseAll = async () => {
    if (phrase !== "RESET") return;
    setBusy(true);
    setMsg(null);
    try {
      // 1) Backup: download the full CSV before touching anything.
      const res = await fetch("/api/export.csv", { cache: "no-store" });
      if (res.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!res.ok) throw new Error("Couldn't download the backup, nothing was erased");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `baby-movement-backup-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      // 2) Erase.
      await api("/api/reset", { method: "POST", body: { confirm: "RESET" } });
      cancel();
      setMsg({ ok: true, text: "All data erased. A backup CSV was downloaded. Tracking starts from now." });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card danger-zone desktop-only" aria-label="Reset all data">
      <h2>Reset all data</h2>
      <p className="muted small">
        Erases every logged hour and every tap, and starts tracking again from now. Settings,
        login and reminders are kept. Only shown on a laptop or desktop.
      </p>

      {step === 0 && (
        <button type="button" className="btn danger" onClick={() => { setMsg(null); setStep(1); }}>
          Reset all data…
        </button>
      )}

      {step === 1 && (
        <div className="reset-step">
          <p><strong>Are you sure?</strong> This permanently deletes all movement history. It can&apos;t be undone.</p>
          <div className="row-actions">
            <button type="button" className="btn danger" onClick={() => setStep(2)}>
              Yes, continue
            </button>
            <button type="button" className="btn" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <form
          className="reset-step"
          onSubmit={(e) => {
            e.preventDefault();
            void eraseAll();
          }}
        >
          <p>
            <strong>Final check.</strong> A CSV backup will download first, then everything is erased.
            Type <code>RESET</code> to confirm.
          </p>
          <input
            className="input"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="RESET"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Type RESET to confirm"
            autoFocus
          />
          <div className="row-actions">
            <button type="submit" className="btn danger" disabled={busy || phrase !== "RESET"}>
              {busy ? "Erasing…" : "Download backup and erase everything"}
            </button>
            <button type="button" className="btn" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
    </section>
  );
}
