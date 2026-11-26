// Edge-safe session cookie signing/verification (Web Crypto only).

export const SESSION_COOKIE = "bm_session";
export const SESSION_MAX_AGE = 400 * 24 * 60 * 60; // seconds

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (length is not secret). */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Token format: `<issuedAtMs>.<hex hmacSHA256(secret, issuedAtMs)>`. */
export async function signSession(secret: string, issuedAt = Date.now()): Promise<string> {
  return `${issuedAt}.${await hmacHex(secret, String(issuedAt))}`;
}

export async function verifySession(token: string | undefined, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !secret) return false;
  const m = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return false;
  const issuedAt = Number(m[1]);
  if (issuedAt > now + 5 * 60_000 || now - issuedAt > SESSION_MAX_AGE * 1000) return false;
  return safeEqual(m[2], await hmacHex(secret, m[1]));
}
