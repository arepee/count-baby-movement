"use client";

import { useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/client/api";

export default function LoginPage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/login", { method: "POST", body: { code: value } });
      window.location.replace("/");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "Wrong code" : errorMessage(e));
      setCode("");
      setShake(false);
      // restart the animation
      requestAnimationFrame(() => setShake(true));
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const onChange = (raw: string) => {
    const v = raw.replace(/\D/g, "").slice(0, 4);
    setCode(v);
    if (error) setError(null);
    if (v.length === 4) void submit(v);
  };

  return (
    <div className="login">
      <h1>Baby Movement</h1>
      <p className="muted">Enter your 4-digit code</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 4) void submit(code);
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
          onChange={(e) => onChange(e.target.value)}
        />
      </form>
      <p className="error" role="alert" style={{ minHeight: "1.4em" }}>
        {busy ? "" : error}
      </p>
    </div>
  );
}
