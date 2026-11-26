// Neon Postgres data access (server only).

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { Entry, Settings, SettingsInput, Slot } from "./types";

// Mirrors src/lib/schema.sql (embedded: reading files at runtime on Vercel is fragile).
export const SCHEMA_SQL = `
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  sleep_start text not null default '23:30',
  sleep_end text not null default '07:30',
  timezone text not null default 'Asia/Kolkata',
  tracking_start timestamptz not null default now(),
  last_notified_slot timestamptz,
  last_notified_at timestamptz
);
create table if not exists entries (
  id serial primary key,
  slot_start timestamptz not null unique,
  slot_end timestamptz not null,
  is_sleep boolean not null default false,
  kicks int not null default 0 check (kicks >= 0),
  rolls int not null default 0 check (rolls >= 0),
  other int not null default 0 check (other >= 0),
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;
`;

type Row = Record<string, unknown>;
let client: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<void> | null = null;

function sql(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

/** Create tables if missing. Memoised per server instance; retried after a failure. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const statements = SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean);
    const db = sql();
    schemaReady = db
      .transaction(statements.map((s) => db.query(s)))
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

async function q(text: string, params: unknown[] = []): Promise<Row[]> {
  await ensureSchema();
  return (await sql().query(text, params)) as Row[];
}

const isoOf = (v: unknown): string => new Date(v as string | Date).toISOString();
const isoOrNull = (v: unknown): string | null => (v == null ? null : isoOf(v));

export function rowToEntry(r: Row): Entry {
  return {
    id: Number(r.id),
    slotStart: isoOf(r.slot_start),
    slotEnd: isoOf(r.slot_end),
    isSleep: Boolean(r.is_sleep),
    kicks: Number(r.kicks),
    rolls: Number(r.rolls),
    other: Number(r.other),
    skipped: Boolean(r.skipped),
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

// ---------- Settings ----------

export type SettingsRecord = Settings & { lastNotifiedSlot: string | null; lastNotifiedAt: string | null };

function rowToSettings(r: Row): SettingsRecord {
  return {
    sleepStart: String(r.sleep_start),
    sleepEnd: String(r.sleep_end),
    timezone: String(r.timezone),
    trackingStart: isoOf(r.tracking_start),
    lastNotifiedSlot: isoOrNull(r.last_notified_slot),
    lastNotifiedAt: isoOrNull(r.last_notified_at),
  };
}

export async function getSettings(): Promise<SettingsRecord> {
  let rows = await q("select * from settings where id = 1");
  if (!rows[0]) rows = await q("insert into settings (id) values (1) on conflict (id) do update set id = 1 returning *");
  return rowToSettings(rows[0]);
}

export async function updateSettings(s: SettingsInput): Promise<SettingsRecord> {
  await getSettings(); // make sure the row exists
  const rows = await q(
    "update settings set sleep_start = $1, sleep_end = $2, timezone = $3 where id = 1 returning *",
    [s.sleepStart, s.sleepEnd, s.timezone],
  );
  return rowToSettings(rows[0]);
}

export async function setLastNotified(slotStart: string, at: Date): Promise<void> {
  await q("update settings set last_notified_slot = $1, last_notified_at = $2 where id = 1", [slotStart, at.toISOString()]);
}

/** Strip internal fields before sending settings to the client. */
export const publicSettings = ({ sleepStart, sleepEnd, timezone, trackingStart }: SettingsRecord): Settings => ({
  sleepStart,
  sleepEnd,
  timezone,
  trackingStart,
});

// ---------- Entries ----------

export type Counts = { kicks: number; rolls: number; other: number; skipped: boolean };

export async function upsertEntry(slot: Slot, c: Counts): Promise<Entry> {
  const rows = await q(
    `insert into entries (slot_start, slot_end, is_sleep, kicks, rolls, other, skipped)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (slot_start) do update set slot_end = excluded.slot_end, is_sleep = excluded.is_sleep,
       kicks = excluded.kicks, rolls = excluded.rolls, other = excluded.other,
       skipped = excluded.skipped, updated_at = now()
     returning *`,
    [slot.start, slot.end, slot.isSleep, c.kicks, c.rolls, c.other, c.skipped],
  );
  return rowToEntry(rows[0]);
}

export async function updateEntry(id: number, c: Counts): Promise<Entry | null> {
  const rows = await q(
    `update entries set kicks = $2, rolls = $3, other = $4, skipped = $5, updated_at = now()
     where id = $1 returning *`,
    [id, c.kicks, c.rolls, c.other, c.skipped],
  );
  return rows[0] ? rowToEntry(rows[0]) : null;
}

export async function deleteEntry(id: number): Promise<boolean> {
  const rows = await q("delete from entries where id = $1 returning id", [id]);
  return rows.length > 0;
}

/** Entries with slot_start in [from, to), newest first. Either bound may be omitted. */
export async function listEntries(from?: Date | null, to?: Date | null): Promise<Entry[]> {
  const rows = await q(
    `select * from entries
     where ($1::timestamptz is null or slot_start >= $1) and ($2::timestamptz is null or slot_start < $2)
     order by slot_start desc`,
    [from?.toISOString() ?? null, to?.toISOString() ?? null],
  );
  return rows.map(rowToEntry);
}

/** Slot ranges of entries ending after `since` (for pending computation). */
export async function entryRangesSince(since: string): Promise<{ slotStart: string; slotEnd: string }[]> {
  const rows = await q("select slot_start, slot_end from entries where slot_end > $1", [since]);
  return rows.map((r) => ({ slotStart: isoOf(r.slot_start), slotEnd: isoOf(r.slot_end) }));
}

// ---------- Push subscriptions ----------

export type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string };

export async function upsertSubscription(s: PushSubscriptionRow): Promise<void> {
  await q(
    `insert into push_subscriptions (endpoint, p256dh, auth, enabled) values ($1, $2, $3, true)
     on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, enabled = true`,
    [s.endpoint, s.p256dh, s.auth],
  );
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await q("delete from push_subscriptions where endpoint = $1", [endpoint]);
}

export async function listSubscriptions(): Promise<PushSubscriptionRow[]> {
  const rows = await q("select endpoint, p256dh, auth from push_subscriptions where enabled");
  return rows.map((r) => ({ endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth) }));
}
