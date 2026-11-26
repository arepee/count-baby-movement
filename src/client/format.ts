// Client-side formatting helpers. All wall-clock output uses the configured
// IANA timezone from settings (not the device's), so labels match the server.

type SlotLike = { start: string; end: string; isSleep: boolean };

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz });
    } catch {
      // Invalid timezone: fall back to the device timezone rather than crash.
      f = new Intl.DateTimeFormat("en-US", opts);
    }
    fmtCache.set(key, f);
  }
  return f;
}

/** "2:30 PM" */
export function formatTime(iso: string, tz: string): string {
  return fmt(tz, { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

/** "Thu" */
export function formatWeekday(iso: string, tz: string): string {
  return fmt(tz, { weekday: "short" }).format(new Date(iso));
}

/** "2:30 PM – 3:30 PM" */
export function formatSlotRange(slot: SlotLike, tz: string): string {
  return `${formatTime(slot.start, tz)} – ${formatTime(slot.end, tz)}`;
}

/** "Thu 2:30 PM – 3:30 PM" or "Night · 11:30 PM – 7:30 AM" */
export function formatSlotLabel(slot: SlotLike, tz: string): string {
  if (slot.isSleep) return `Night · ${formatSlotRange(slot, tz)}`;
  return `${formatWeekday(slot.start, tz)} ${formatSlotRange(slot, tz)}`;
}

/** Local calendar day key "YYYY-MM-DD" in tz. */
export function dayKey(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = fmt(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** "Today", "Yesterday", or "Wed, Nov 25" for a day key. */
export function formatDayHeading(key: string, tz: string, now: Date = new Date()): string {
  const today = dayKey(now, tz);
  if (key === today) return "Today";
  if (key === shiftKey(today, -1)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  // Noon UTC on that date formatted in UTC: stable regardless of tz.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(dt);
}

/** "42 min" / "1 h 5 min" / "<1 min" */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0 min";
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "<1 min";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export type Totals = { kicks: number; rolls: number; other: number };

export function sumTotals(
  entries: { kicks: number; rolls: number; other: number; skipped: boolean }[],
): Totals {
  const t: Totals = { kicks: 0, rolls: 0, other: 0 };
  for (const e of entries) {
    if (e.skipped) continue;
    t.kicks += e.kicks;
    t.rolls += e.rolls;
    t.other += e.other;
  }
  return t;
}

/** Group items by local day of their slotStart, preserving input order. */
export function groupByDay<T extends { slotStart: string }>(
  items: T[],
  tz: string,
): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = [];
  const index = new Map<string, { key: string; items: T[] }>();
  for (const it of items) {
    const k = dayKey(it.slotStart, tz);
    let g = index.get(k);
    if (!g) {
      g = { key: k, items: [] };
      index.set(k, g);
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}
