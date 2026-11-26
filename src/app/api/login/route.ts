import { getSettings, recordFailedLogin, resetFailedLogins } from "@/lib/db";
import { badRequest, handle, json, readJson } from "@/lib/http";
import {
  LOCKOUT_BASE_MINUTES,
  LOCKOUT_MAX_MINUTES,
  LOCKOUT_THRESHOLD,
  lockMessage,
  lockRemainingMinutes,
} from "@/lib/lockout";
import { SESSION_COOKIE, SESSION_MAX_AGE, safeEqual, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  const body = await readJson(req);
  const code = (body as { code?: unknown } | undefined)?.code;
  if (typeof code !== "string" && typeof code !== "number") return badRequest('"code" is required');
  const expected = process.env.APP_CODE;
  const secret = process.env.AUTH_SECRET;
  if (!expected || !secret) return json({ error: "Server is missing APP_CODE or AUTH_SECRET" }, 500);

  // While locked, don't even compare the code.
  const locked = lockRemainingMinutes((await getSettings()).lockedUntil);
  if (locked > 0) return json({ error: lockMessage(locked) }, 429);

  if (!safeEqual(String(code).trim(), expected)) {
    const s = await recordFailedLogin(LOCKOUT_THRESHOLD, LOCKOUT_BASE_MINUTES, LOCKOUT_MAX_MINUTES);
    const nowLocked = lockRemainingMinutes(s.lockedUntil);
    if (nowLocked > 0) return json({ error: lockMessage(nowLocked) }, 429);
    return json({ error: "Wrong code" }, 401);
  }

  await resetFailedLogins();
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSession(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
});
