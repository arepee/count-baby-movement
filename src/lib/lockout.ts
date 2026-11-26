// Login brute-force protection (the code is only 4 digits). State lives in the
// settings row (failed_logins, locked_until); see recordFailedLogin() in db.ts.

export const LOCKOUT_THRESHOLD = 5; // consecutive failures before the first lock
export const LOCKOUT_BASE_MINUTES = 5; // first lock; doubles for each further failure
export const LOCKOUT_MAX_MINUTES = 60;

/** Lock length (minutes) after `failures` consecutive failures; 0 = not locked. Mirrors the SQL in db.ts. */
export function lockoutMinutes(failures: number): number {
  if (failures < LOCKOUT_THRESHOLD) return 0;
  return Math.min(LOCKOUT_MAX_MINUTES, LOCKOUT_BASE_MINUTES * 2 ** Math.min(failures - LOCKOUT_THRESHOLD, 10));
}

/** Whole minutes left on a lock (at least 1), or 0 if `lockedUntil` is not in the future. */
export function lockRemainingMinutes(lockedUntil: string | null, now = Date.now()): number {
  if (!lockedUntil) return 0;
  const left = new Date(lockedUntil).getTime() - now;
  return left > 0 ? Math.max(1, Math.ceil(left / 60_000)) : 0;
}

export const lockMessage = (minutes: number) => `Too many attempts. Try again in ${minutes} min.`;
