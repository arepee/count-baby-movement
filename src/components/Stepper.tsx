"use client";

import { useState } from "react";
import type { Counts } from "@/client/types";

const MAX = 999;

function clamp(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX, Math.floor(n)));
}

export function Stepper({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== "") onChange(clamp(Number(draft)));
  };

  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button
          type="button"
          className="step-btn"
          aria-label={`Decrease ${label}`}
          disabled={disabled || value <= 0}
          onClick={() => onChange(clamp(value - 1))}
        >
          −
        </button>
        {editing ? (
          <input
            className="step-input"
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            min={0}
            max={MAX}
            autoFocus
            value={draft}
            aria-label={label}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="step-value"
            aria-label={`${label}: ${value}. Tap to type a number`}
            disabled={disabled}
            onClick={() => {
              setDraft(value === 0 ? "" : String(value));
              setEditing(true);
            }}
          >
            {value}
          </button>
        )}
        <button
          type="button"
          className="step-btn"
          aria-label={`Increase ${label}`}
          disabled={disabled || value >= MAX}
          onClick={() => onChange(clamp(value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export type { Counts };

export function CountSteppers({
  counts,
  onChange,
  disabled,
}: {
  counts: Counts;
  onChange: (c: Counts) => void;
  disabled?: boolean;
}) {
  return (
    <div className="steppers">
      <Stepper
        label="Kicks"
        value={counts.kicks}
        disabled={disabled}
        onChange={(kicks) => onChange({ ...counts, kicks })}
      />
      <Stepper
        label="Rolls"
        value={counts.rolls}
        disabled={disabled}
        onChange={(rolls) => onChange({ ...counts, rolls })}
      />
      <Stepper
        label="Other"
        value={counts.other}
        disabled={disabled}
        onChange={(other) => onChange({ ...counts, other })}
      />
    </div>
  );
}
