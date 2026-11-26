"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/client/api";

function normalize(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 4);
}

export default function LoginPage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ref guard (not state) so a submit triggered from the mount effect and one
  // from an input event in the same tick can't both fire.
  const busyRef = useRef(false);

  const submit = async (value: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await api("/api/login", { method: "POST", body: { code: value } });
      window.location.replace("/");
    } catch (e) {
      // 401 → wrong code; anything else (e.g. 429 "Too many attempts…") shows the server message.
      setError(e instanceof ApiError && e.status === 401 ? "Wrong code" : errorMessage(e));
      setCode("");
      setShake(false);
      // restart the animation
      requestAnimationFrame(() => setShake(true));
      busyRef.current = false;
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const handleValue = (raw: string) => {
    const v = normalize(raw);
    setCode(v);
    if (error) setError(null);
    if (v.length === 4) void submitRef.current(v);
  };

  // Digits typed before hydration live only in the DOM; the controlled value
  // ("") would wipe them. Adopt whatever is there, autosubmit if complete, and
  // make sure the field is focused.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const v = normalize(el.value);
    if (v) {
      setCode(v);
      if (v.length === 4) void submitRef.current(v);
    }
    if (document.activeElement !== el) el.focus();
  }, []);

  return (
    <div className="login">
      <h1>Baby Movement</h1>
      <p className="muted">Enter your 4-digit code</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = normalize(inputRef.current?.value ?? code);
          if (v.length === 4) void submit(v);
        }}
      >
        <input
          ref={inputRef}
          className={shake ? "code-input shake" : "code-input"}
          onAnimationEnd={() => setShake(false)}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={4}
          autoFocus
          aria-label="4-digit code"
          aria-invalid={error ? true : undefined}
          value={code}
          disabled={busy}
          onChange={(e) => handleValue(e.currentTarget.value)}
          onInput={(e) => {
            // Some autofill paths (iOS one-time-code) fire input without a
            // React change; read the DOM value directly.
            const v = normalize(e.currentTarget.value);
            if (v !== code) handleValue(v);
          }}
        />
      </form>
      <p className="error" role="alert" style={{ minHeight: "1.4em" }}>
        {busy ? "" : error}
      </p>
    </div>
  );
}
