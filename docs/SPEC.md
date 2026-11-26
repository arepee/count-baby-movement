# Baby Movement Log — Spec & Contracts

Utilitarian mobile-first PWA (installed to iPhone home screen) for logging fetal
movement per hour, 24/7. Next.js 15 App Router, TypeScript, `src/` dir, plain CSS
(no Tailwind, no UI libs). Deployed on Vercel. DB: Neon Postgres via
`@neondatabase/serverless`. Push: `web-push` (VAPID). Hourly trigger: GitHub Actions.

## Env vars
| Var | Purpose |
|---|---|
| `APP_CODE` | 4-digit login code |
| `AUTH_SECRET` | random string, HMAC key for session cookie |
| `DATABASE_URL` | Neon connection string |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID public key (also used server side) |
| `VAPID_PRIVATE_KEY` | VAPID private key |
| `VAPID_SUBJECT` | e.g. `mailto:you@example.com` |
| `CRON_SECRET` | bearer token the GitHub Action sends to `/api/cron` |

## Domain model

### Slots
Time is divided into **slots**, computed in the configured IANA `timezone`.
- Sleep window default `23:30`–`07:30` (HH:MM local, may cross midnight).
- **Awake slots** are 1 hour long and anchored to the wake time: 07:30–08:30,
  08:30–09:30, … The last awake slot before sleep is truncated to end at
  sleep start if the window isn't a whole number of hours.
- **Sleep slot**: the whole sleep window is ONE slot (e.g. 23:30–07:30) answered
  with a single entry.
- If sleep start == sleep end, there's no sleep window (24 hourly slots anchored at that minute).
- A slot is identified by its `start` (UTC ISO string). `end` is exclusive.
- DST: compute with local wall-clock times converted to UTC; tolerate 23h/25h days
  (slots must never overlap and must tile time without gaps).

### Pending slots
`tracking_start` (timestamptz, set on first DB init = now) is the earliest point
of interest. Pending = every slot that has **ended** (`end <= now`), whose `start >=`
the slot containing tracking_start, and that has no entry. Returned oldest first.
Cap at most recent 72 pending slots (older ones are ignored).

The UI requires clearing pending slots (oldest first) before showing the "current"
state. Each pending slot can be answered with counts, or **skipped** (recorded
with `skipped=true`, counts 0) for "didn't track".

### Entry
```ts
type Entry = {
  id: number;
  slotStart: string;   // ISO UTC
  slotEnd: string;     // ISO UTC
  isSleep: boolean;
  kicks: number;       // >= 0 int
  rolls: number;
  other: number;
  skipped: boolean;
  createdAt: string;
  updatedAt: string;
};
type Slot = { start: string; end: string; isSleep: boolean };
type Settings = {
  sleepStart: string;  // "HH:MM"
  sleepEnd: string;    // "HH:MM"
  timezone: string;    // IANA, e.g. "Asia/Kolkata"
  trackingStart: string; // ISO
};
```
Shared types live in `src/lib/types.ts` (owned by backend agent; others import).

## DB schema (`src/lib/schema.sql`, also auto-applied idempotently by `ensureSchema()`)
```sql
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  sleep_start text not null default '23:30',
  sleep_end text not null default '07:30',
  timezone text not null default 'Asia/Kolkata',
  tracking_start timestamptz not null default now(),
  last_notified_slot timestamptz,       -- slot start most recently notified about
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
```

## Auth
- `POST /api/login {code}` → compares to `APP_CODE` (constant-time). On success sets
  cookie `bm_session` = `<issuedAtMs>.<hmacSHA256(AUTH_SECRET, issuedAtMs)>`,
  httpOnly, secure (in prod), sameSite=lax, path=/, maxAge 400 days. Returns `{ok:true}`;
  wrong code → 401 `{error}`. Basic throttle not required.
- `POST /api/logout` clears cookie.
- `src/middleware.ts`: everything requires a valid session EXCEPT `/login`,
  `/api/login`, `/api/cron`, `/manifest.webmanifest`, `/sw.js`, `/icons/*`,
  `/_next/*`, `/favicon.ico`, `/apple-touch-icon.png`. Unauthed page requests → redirect `/login`; unauthed API → 401.
  Middleware runs on Edge: use Web Crypto (`crypto.subtle`), not node `crypto`.
  Put verify logic in `src/lib/session.ts` (Edge-safe).

## API (all JSON; all require session except where noted)
| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/state` | — | `{ now, settings, pending: Slot[], current: Slot, recent: Entry[] }` — `current` is the slot containing now (in progress); `recent` = entries from last 7 days, newest first |
| `POST /api/entries` | `{slotStart, kicks, rolls, other, skipped?}` | `{entry}`. Server recomputes the slot from `slotStart` + settings and rejects (400) if slotStart isn't a valid slot boundary or slot hasn't ended yet. Upsert on slot_start. |
| `PATCH /api/entries/:id` | `{kicks, rolls, other, skipped?}` | `{entry}` |
| `DELETE /api/entries/:id` | — | `{ok:true}` |
| `GET /api/entries?from=ISO&to=ISO` | — | `{entries: Entry[]}` (history, newest first) |
| `GET /api/settings` / `PUT /api/settings` | `{sleepStart, sleepEnd, timezone}` | `{settings}`; validate HH:MM and timezone via `Intl.DateTimeFormat` |
| `POST /api/push/subscribe` | `PushSubscriptionJSON` | `{ok:true}` (upsert, enabled=true) |
| `POST /api/push/unsubscribe` | `{endpoint}` | `{ok:true}` (delete) |
| `POST /api/push/test` | — | sends a test push to all subscriptions; `{sent:n}` |
| `GET or POST /api/cron` | header `Authorization: Bearer $CRON_SECRET` (NO session) | `{notified:boolean, reason, pending:n}` |
| `GET /api/export.csv` | — | CSV of all entries |

## Reminder logic (`/api/cron`, called every 30 min by GitHub Actions)
1. If now is inside the sleep window → do nothing (`reason:"sleeping"`).
2. Compute pending slots. If none → nothing.
3. Let `latest` = most recent pending slot. If `latest.start != last_notified_slot`
   → notify ("Log baby movement for 2:30–3:30 PM" — if >1 pending: "N hours to log, starting …"; for the sleep slot: "Good morning — log movement for the night").
   Else if pending exists and `last_notified_at` older than 55 min → re-remind
   ("Still waiting: N hour(s) to log").
4. Update last_notified_slot/at. Delete subscriptions that return 404/410.
Push payload JSON: `{title, body, url:"/", tag:"bm-reminder"}`.

## Front end (utilitarian)
Single main screen `/`, plus `/history`, `/settings`, `/login`. No decorative
imagery; system font; big tap targets (≥48px); works great at 375px wide;
respects dark mode via `prefers-color-scheme`. Bottom nav: Log · History · Settings.

**Log screen**
- If pending: banner "N hour(s) to log". Shows the OLDEST pending slot label
  (e.g. "Thu 2:30 PM – 3:30 PM" or "Night · 11:30 PM – 7:30 AM"), three rows
  Kicks / Rolls / Other each with big − [count] + steppers, buttons **Save** and
  **Didn't track**. After save, advance to next pending.
- If none pending: "All caught up". Shows current in-progress slot with time
  remaining until it ends, today's totals (kicks/rolls/other), last few entries.
- Notification permission prompt card if push is supported and not yet subscribed
  on this device (iOS: only works when launched from home screen — show hint
  "Add to Home Screen first" if `navigator.standalone` false on iOS).
- Refetch state on `visibilitychange` → visible, and every 60s while visible.

**History**: grouped by local day (settings timezone), each day shows totals and a
row per slot (time label, K/R/O counts, "skipped" marker); tap row to edit
(steppers) or delete. Load last 14 days, "Load more". Link to export CSV.

**Settings**: sleep start/end (`<input type="time">`), timezone (prefilled from
`Intl.DateTimeFormat().resolvedOptions().timeZone`, select or text), Save.
Notifications section: status for this device, Enable/Disable, "Send test".
Logout button.

**Login**: 4-digit numeric input (`inputmode="numeric"`, `autocomplete="one-time-code"`), autosubmits on 4 digits.

## PWA
- `src/app/manifest.ts` (name "Baby Movement", short_name "Kicks", display
  standalone, start_url "/", theme/background colors, icons 192/512 + maskable).
- Icons in `public/icons/` (generate simple PNGs — a solid color square with a
  simple glyph is fine), `public/apple-touch-icon.png` 180x180.
- `layout.tsx` metadata: `appleWebApp: {capable:true, title:"Kicks", statusBarStyle:"default"}`, viewport with `viewportFit:"cover"`, safe-area padding.
- `public/sw.js`: handles `push` (showNotification with tag, renotify true),
  `notificationclick` (focus existing client or open url). No offline caching needed.
- Register SW in a client component on load.

## File ownership (for parallel agents)
- **Backend agent**: `src/lib/**` (types, db, schema, slots, tz, session, auth, push send helper), `src/middleware.ts`, `src/app/api/**`, unit tests in `src/lib/__tests__/` (vitest), `vitest.config.ts`, npm scripts `test`.
- **Frontend agent**: `src/app/page.tsx`, `src/app/(pages)/**` or `src/app/history|settings|login/**`, `src/app/layout.tsx`, `src/app/globals.css`, `src/components/**`, client-side push subscribe helper `src/client/**`.
- **Platform agent**: `public/sw.js`, `public/icons/**`, `public/apple-touch-icon.png`, `src/app/manifest.ts`, `.github/workflows/cron.yml`, `.env.example`, `README.md`, `scripts/**` (e.g. `scripts/vapid.mjs` to generate keys, `scripts/migrate.mjs`).
Don't edit files outside your ownership; if you need something from another area, code against this spec.
