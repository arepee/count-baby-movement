// Request-body validation helpers. Each returns either a value or an error string.

import type { EntryUpdate, SettingsInput } from "./types";
import { isValidTimeZone, parseHHMM } from "./tz";

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

export function parseSettings(body: unknown): Result<SettingsInput> {
  if (!isObj(body)) return { ok: false, error: "Body must be a JSON object" };
  const { sleepStart, sleepEnd, timezone } = body;
  if (parseHHMM(sleepStart) === null) return { ok: false, error: '"sleepStart" must be HH:MM (24h)' };
  if (parseHHMM(sleepEnd) === null) return { ok: false, error: '"sleepEnd" must be HH:MM (24h)' };
  if (!isValidTimeZone(timezone)) return { ok: false, error: '"timezone" must be a valid IANA time zone' };
  return { ok: true, value: { sleepStart: sleepStart as string, sleepEnd: sleepEnd as string, timezone } };
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
