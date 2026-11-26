// Shared types (contract in docs/SPEC.md). Safe to import from client and server.

export type Entry = {
  id: number;
  slotStart: string; // ISO UTC
  slotEnd: string; // ISO UTC
  isSleep: boolean;
  kicks: number; // >= 0 int
  rolls: number;
  other: number;
  skipped: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Slot = { start: string; end: string; isSleep: boolean };

export type Settings = {
  sleepStart: string; // "HH:MM"
  sleepEnd: string; // "HH:MM"
  timezone: string; // IANA, e.g. "Asia/Kolkata"
  trackingStart: string; // ISO; pending slots start at the slot containing this
  initialized: boolean; // false until POST /api/setup has run (first launch on the device)
  dueDate: string | null; // "YYYY-MM-DD" or null when not set
};

/**
 * Settings fields a client may change (PUT /api/settings). `dueDate` is optional:
 * omitted = unchanged, null = clear, "YYYY-MM-DD" = set.
 */
export type SettingsInput = Pick<Settings, "sleepStart" | "sleepEnd" | "timezone"> & {
  dueDate?: string | null;
};

/** POST /api/entries body. Counts may be omitted when skipped=true. */
export type EntryInput = {
  slotStart: string;
  kicks: number;
  rolls: number;
  other: number;
  skipped?: boolean;
};

/** PATCH /api/entries/:id body. */
export type EntryUpdate = Omit<EntryInput, "slotStart">;

export type StateResponse = {
  now: string;
  settings: Settings;
  pending: Slot[]; // oldest first, max 72
  current: Slot; // slot containing now (in progress)
  recent: Entry[]; // last 7 days, newest first
};

/** Per-day aggregate for Insights (day keys follow slotDayKey()). */
export type DayStat = {
  key: string; // "YYYY-MM-DD"
  kicks: number;
  rolls: number;
  other: number;
  total: number;
  loggedHours: number; // hours covered by non-skipped entries (night counts its real length)
  skippedHours: number;
  night: number | null; // total of the night slot counted on this day (null if none/skipped)
};

export type InsightsResponse = {
  now: string;
  settings: Settings;
  pregnancy: { week: number; day: number } | null;
  today: DayStat & {
    usualByNow: number | null; // mean total over the previous 7 days up to the same local time; null if < 3 qualifying days
    usualDays: number; // how many days went into usualByNow
    lowerThanUsual: boolean; // usualByNow >= 10 && total < 0.5 * usualByNow && >= 50% of today's hours logged
  };
  days: DayStat[]; // last `days` days, newest first, including today; days before tracking start omitted
  // Last 7 days newest first; cells[h] by local START hour. future[h] = true when that
  // awake slot of the day hasn't ended yet (in-progress included; only ever on today's row).
  grid: { key: string; cells: (number | null)[]; future: boolean[]; night: number | null }[];
  hourAvg: (number | null)[]; // 24 values: mean of non-null grid cells per hour
  weeks: { label: string; week: number | null; startKey: string; endKey: string; avgPerDay: number; days: number }[]; // newest first
};

export type EntryResponse = { entry: Entry };
export type EntriesResponse = { entries: Entry[] };
export type SettingsResponse = { settings: Settings };
export type OkResponse = { ok: true };
export type ErrorResponse = { error: string };
export type PushTestResponse = { sent: number; failed: number; removed: number };
export type CronResponse = {
  notified: boolean;
  reason: string;
  pending: number;
  sent?: number;
  failed?: number;
  removed?: number;
  error?: string;
};

/** POST /api/setup body (first-run setup and "Restart tracking from now"). */
export type SetupInput = { timezone: string };

export type PushPayload = { title: string; body: string; url: string; tag: string };
