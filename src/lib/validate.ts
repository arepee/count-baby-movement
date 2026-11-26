// Request-body validation helpers. Each returns either a value or an error string.

import type { EntryUpdate, SettingsInput, SetupInput } from "./types";
import { isValidTimeZone, localDateKey, parseHHMM } from "./tz";

export const MAX_COUNT = 999;
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function count(v: unknown, name: string, optional: boolean): Result<number> {
  if (v === undefined || v === null) {
    return optional ? { ok: true, value: 0 } : { ok: false, error: `"${name}" is required` };
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_COUNT) {
    return { ok: false, error: `"${name}" must be an integer between 0 and ${MAX_COUNT}` };
  }
  return { ok: true, value: v };
}

/** Validate {kicks, rolls, other, skipped?}. Counts may be omitted (and are forced to 0) when skipped. */
export function parseCounts(body: unknown): Result<Required<EntryUpdate>> {
  if (!isObj(body)) return { ok: false, error: "Body must be a JSON object" };
  if (body.skipped !== undefined && typeof body.skipped !== "boolean") {
    return { ok: false, error: '"skipped" must be a boolean' };
  }
  const skipped = body.skipped === true;
  const out = { kicks: 0, rolls: 0, other: 0, skipped };
  for (const k of ["kicks", "rolls", "other"] as const) {
    const r = count(body[k], k, skipped);
    if (!r.ok) return r;
    out[k] = skipped ? 0 : r.value;
  }
  return { ok: true, value: out };
}

/** Allowed due-date range, in days relative to today (settings timezone). */
export const DUE_DATE_MIN_DAYS = -30;
export const DUE_DATE_MAX_DAYS = 300;

/** Day number (days since 1970-01-01) of a real "YYYY-MM-DD" calendar date, or null. */
export function dayNumber(key: unknown): number | null {
  if (typeof key !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

/**
 * Validate an optional due date: undefined (unchanged), null (clear) or a real
 * "YYYY-MM-DD" within DUE_DATE_MIN_DAYS..DUE_DATE_MAX_DAYS of today in `timeZone`.
 */
export function parseDueDate(v: unknown, timeZone: string, now: Date = new Date()): Result<string | null | undefined> {
  if (v === undefined || v === null) return { ok: true, value: v };
  const err = `"dueDate" must be a date (YYYY-MM-DD) between ${-DUE_DATE_MIN_DAYS} days ago and ${DUE_DATE_MAX_DAYS} days from today, or null`;
  const n = dayNumber(v);
  if (n === null) return { ok: false, error: err };
  const today = dayNumber(localDateKey(now, timeZone))!;
  if (n - today < DUE_DATE_MIN_DAYS || n - today > DUE_DATE_MAX_DAYS) return { ok: false, error: err };
  return { ok: true, value: v as string };
}

export function parseSettings(body: unknown, now: Date = new Date()): Result<SettingsInput> {
  if (!isObj(body)) return { ok: false, error: "Body must be a JSON object" };
  const { sleepStart, sleepEnd, timezone } = body;
  if (parseHHMM(sleepStart) === null) return { ok: false, error: '"sleepStart" must be HH:MM (24h)' };
  if (parseHHMM(sleepEnd) === null) return { ok: false, error: '"sleepEnd" must be HH:MM (24h)' };
  if (!isValidTimeZone(timezone)) return { ok: false, error: '"timezone" must be a valid IANA time zone' };
  const due = parseDueDate(body.dueDate, timezone, now);
  if (!due.ok) return due;
  const value: SettingsInput = { sleepStart: sleepStart as string, sleepEnd: sleepEnd as string, timezone };
  if (due.value !== undefined) value.dueDate = due.value;
  return { ok: true, value };
}

export function parseSetup(body: unknown): Result<SetupInput> {
  if (!isObj(body)) return { ok: false, error: "Body must be a JSON object" };
  if (!isValidTimeZone(body.timezone)) return { ok: false, error: '"timezone" must be a valid IANA time zone' };
  return { ok: true, value: { timezone: body.timezone } };
}

export type PushSub = { endpoint: string; p256dh: string; auth: string };

export function parseSubscription(body: unknown): Result<PushSub> {
  if (!isObj(body) || typeof body.endpoint !== "string" || !/^https:\/\//.test(body.endpoint)) {
    return { ok: false, error: '"endpoint" must be an https URL' };
  }
  const keys = isObj(body.keys) ? body.keys : {};
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || !keys.p256dh || !keys.auth) {
    return { ok: false, error: '"keys.p256dh" and "keys.auth" are required' };
  }
  return { ok: true, value: { endpoint: body.endpoint, p256dh: keys.p256dh, auth: keys.auth } };
}

/** Parse an ISO timestamp query/body value. */
export function parseInstant(v: unknown, name: string): Result<Date> {
  const d = typeof v === "string" && v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return { ok: false, error: `"${name}" must be an ISO timestamp` };
  return { ok: true, value: d };
}

export function parseId(v: string): Result<number> {
  const n = Number(v);
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n <= 0) return { ok: false, error: "Invalid entry id" };
  return { ok: true, value: n };
}
