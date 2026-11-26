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

/** "2:30 PM" (non-breaking space before AM/PM so labels never wrap as "2:30 / PM") */
export function formatTime(iso: string, tz: string): string {
  return fmt(tz, { hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .replace(/\s+(AM|PM)$/i, "\u00a0$1");
}

/**
 * Legacy IANA names some browsers still report (e.g. Chromium/ICU gives
 * "Asia/Calcutta"), mapped to the current canonical name.
 */
const TZ_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Dacca": "Asia/Dhaka",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Ujung_Pandang": "Asia/Makassar",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Asia/Chongqing": "Asia/Shanghai",
  "Asia/Chungking": "Asia/Shanghai",
  "Asia/Harbin": "Asia/Shanghai",
  "Asia/Kashgar": "Asia/Urumqi",
  "Asia/Tel_Aviv": "Asia/Jerusalem",
  "Asia/Istanbul": "Europe/Istanbul",
  "Europe/Kiev": "Europe/Kyiv",
  "Europe/Uzhgorod": "Europe/Kyiv",
  "Europe/Zaporozhye": "Europe/Kyiv",
  "Europe/Belfast": "Europe/London",
  "Europe/Nicosia": "Asia/Nicosia",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Mendoza": "America/Argentina/Mendoza",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Fort_Wayne": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Godthab": "America/Nuuk",
  "America/Montreal": "America/Toronto",
  "America/Shiprock": "America/Denver",
  "America/Ensenada": "America/Tijuana",
  "America/Santa_Isabel": "America/Tijuana",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Samoa": "Pacific/Pago_Pago",
  "Australia/Canberra": "Australia/Sydney",
  "Australia/ACT": "Australia/Sydney",
  "Australia/NSW": "Australia/Sydney",
  "Africa/Asmera": "Africa/Asmara",
  "Africa/Timbuktu": "Africa/Bamako",
  "US/Eastern": "America/New_York",
  "US/Central": "America/Chicago",
  "US/Mountain": "America/Denver",
  "US/Pacific": "America/Los_Angeles",
  "US/Alaska": "America/Anchorage",
  "US/Hawaii": "Pacific/Honolulu",
  "US/Arizona": "America/Phoenix",
  "Etc/UTC": "UTC",
  "Etc/GMT": "UTC",
  "Etc/Universal": "UTC",
  "Etc/Zulu": "UTC",
  GMT: "UTC",
  Universal: "UTC",
  Zulu: "UTC",
};

/**
 * Canonical (modern) spelling of an IANA timezone name: resolves case/aliases via
 * Intl where possible, then maps known legacy names (Asia/Calcutta → Asia/Kolkata).
 * Unknown/invalid names are returned trimmed and unchanged.
 */
export function canonicalTimezone(tz: string): string {
  const name = tz.trim();
  if (!name) return name;
  let resolved = name;
  try {
    resolved = new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions().timeZone || name;
  } catch {
    return name;
  }
  const modern = TZ_ALIASES[resolved] ?? TZ_ALIASES[name];
  // Only switch to the modern name if this runtime knows it (older ICU lacks e.g. Europe/Kyiv).
  return modern && isKnownTimezone(modern) ? modern : resolved;
}

function isKnownTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** True when two timezone names denote the same zone (e.g. Asia/Calcutta and Asia/Kolkata). */
export function sameTimezone(a: string, b: string): boolean {
  return canonicalTimezone(a) === canonicalTimezone(b);
}

/** The device's IANA timezone (modern spelling, e.g. "Asia/Kolkata"), or "UTC" if unavailable. */
export function deviceTimezone(): string {
  try {
    return canonicalTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") || "UTC";
  } catch {
    return "UTC";
  }
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

type EntryLike = { slotStart: string; slotEnd: string; isSleep: boolean };

/**
 * Local day an entry counts toward. Awake slots belong to the day they start;
 * the night (sleep) slot belongs to the day it ENDS (the wake-up day). We use
 * end − 1 ms so a window ending exactly at midnight stays on the earlier day.
 */
export function entryDayKey(e: EntryLike, tz: string): string {
  if (e.isSleep) return dayKey(new Date(new Date(e.slotEnd).getTime() - 1), tz);
  return dayKey(e.slotStart, tz);
}

/** Group entries by the local day they count toward (see entryDayKey), preserving input order. */
export function groupByDay<T extends EntryLike>(
  items: T[],
  tz: string,
): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = [];
  const index = new Map<string, { key: string; items: T[] }>();
  for (const it of items) {
    const k = entryDayKey(it, tz);
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
