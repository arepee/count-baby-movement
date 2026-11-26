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
};

/** Settings fields a client may change (PUT /api/settings). */
export type SettingsInput = Pick<Settings, "sleepStart" | "sleepEnd" | "timezone">;

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
