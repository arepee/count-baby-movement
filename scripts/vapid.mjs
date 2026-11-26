#!/usr/bin/env node
// Prints fresh secrets in .env format: VAPID key pair, AUTH_SECRET, CRON_SECRET.
// Usage: npm run vapid            (paste output into .env.local / Vercel env vars)
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const webpush = require("web-push");

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
const secret = (n) => randomBytes(n).toString("base64url");

console.log(`# Generated ${new Date().toISOString()}
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com
AUTH_SECRET=${secret(32)}
CRON_SECRET=${secret(32)}
# Also set APP_CODE (4 digits) and DATABASE_URL yourself.`);
