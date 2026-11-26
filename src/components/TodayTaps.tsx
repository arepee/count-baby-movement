"use client";

import { useId, useState } from "react";
import { formatTime, tapKindLabel } from "@/client/format";
import type { Tap } from "@/client/types";

/** Collapsible list of today's taps (newest first), collapsed by default. */
export default function TodayTaps({ taps, tz }: { taps: Tap[]; tz: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (taps.length === 0) return null;

  return (
    <div className="card">
      <button
        type="button"
        className="collapse-head"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <h2>Today&apos;s taps</h2>
        <span className="muted tabular">
          {taps.length} <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </span>
      </button>
      {open && (
        <ul className="list" id={listId}>
          {taps.map((t) => (
            <li key={t.id} className="tap-item">
              <span className="tabular">{formatTime(t.at, tz)}</span>
              <span>{tapKindLabel(t.kind)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
