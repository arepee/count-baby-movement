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

### First run / tracking start
`tracking_start` is the earliest point of interest. Until the app is set up
(`settings.initialized = false`) the stored `tracking_start`/`timezone` are
placeholders (the row is created by whichever request touches the DB first, which
may be the GitHub cron days before the app is installed): nothing is pending and
`/api/cron` replies `reason:"not-set-up"`. When the logged-in app sees
`state.settings.initialized === false` it calls `POST /api/setup {timezone}` with
the device's timezone, which sets `timezone`, `tracking_start = now()`,
`initialized = true` (and clears the reminder bookkeeping). The same call backs the
**Restart tracking from now** button in Settings; existing entries are kept, but
no slot before the slot containing the new `tracking_start` can be pending or logged.

### Pending slots
`cutoff` = start of the 72nd most recent **ended** slot (`end <= now`), counting
every slot whether logged or not (the night counts as one slot). Pending = every
ended slot with no entry whose `start >= max(cutoff, slot containing
tracking_start)`. Returned oldest first, so at most 72. Because the cutoff counts
logged slots too, clearing the backlog never makes older slots resurface; slots
older than the window are simply ignored. Only entries overlapping
`[max(cutoff, tracking slot), now)` are loaded to compute this.

### Day attribution
For grouping by day (History, CSV `date`, "today's totals"), an awake slot belongs
to the local day it **starts**; a night (sleep) slot belongs to the local day it
**ends**, i.e. the wake day (night 23:30 Wed – 07:30 Thu counts toward Thursday).
Helper: `slotDayKey()` in `src/lib/slots.ts`.

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
  initialized: boolean;  // false until POST /api/setup (first run)
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
  last_notified_at timestamptz,
  initialized boolean not null default false, -- set by POST /api/setup
  failed_logins int not null default 0,       -- consecutive failed logins
  locked_until timestamptz                    -- login locked until (brute-force lockout)
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
The last three settings columns were added later; `ensureSchema()` also runs
`alter table settings add column if not exists ...` for each, so existing databases
upgrade automatically (existing rows start as not initialized).

## Auth
- `POST /api/login {code}` → compares to `APP_CODE` (constant-time). On success sets
  cookie `bm_session` = `<issuedAtMs>.<hmacSHA256(AUTH_SECRET, issuedAtMs)>`,
  httpOnly, secure (in prod), sameSite=lax, path=/, maxAge 400 days. Returns `{ok:true}`;
  wrong code → 401 `{error}`.
  **Lockout** (the code is only 4 digits): consecutive failures are counted in
  `settings.failed_logins`. The 5th consecutive failure locks login for 5 min; each
  further failure (made after the lock expires) doubles the lock (10, 20, 40 min),
  capped at 60 min. A success resets the counter. While locked the code is not even
  compared: 429 `{error:"Too many attempts. Try again in N min."}` (the failure that
  triggers a lock also returns 429).
- `POST /api/logout` clears cookie.
- `src/middleware.ts`: everything requires a valid session EXCEPT `/login`,
  `/api/login`, `/api/cron`, `/manifest.webmanifest`, `/sw.js`, `/icons/*`,
  `/_next/*`, `/favicon.ico`, `/apple-touch-icon.png`. Unauthed page requests → redirect `/login`; unauthed API → 401.
  Middleware runs on Edge: use Web Crypto (`crypto.subtle`), not node `crypto`.
  Put verify logic in `src/lib/session.ts` (Edge-safe).

## API (all JSON; all require session except where noted)
| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/state` | — | `{ now, settings, pending: Slot[], current: Slot, recent: Entry[] }` — `current` is the slot containing now (in progress); `recent` = entries from last 7 days, newest first; `pending` is `[]` while `settings.initialized` is false |
| `POST /api/setup` | `{timezone}` | `{settings}`. First-run setup and "Restart tracking from now": validates the IANA timezone, sets it, `tracking_start = now()`, `initialized = true`. 400 on invalid timezone. |
| `POST /api/entries` | `{slotStart, kicks, rolls, other, skipped?}` | `{entry}`. Server recomputes the slot from `slotStart` + settings and rejects (400) if slotStart isn't a valid slot boundary, the slot hasn't ended yet, or it starts before the slot containing `tracking_start`. Upsert on slot_start. |
| `PATCH /api/entries/:id` | `{kicks, rolls, other, skipped?}` | `{entry}` |
| `DELETE /api/entries/:id` | — | `{ok:true}` |
| `GET /api/entries?from=ISO&to=ISO` | — | `{entries: Entry[]}` (history, newest first) |
| `GET /api/settings` / `PUT /api/settings` | `{sleepStart, sleepEnd, timezone}` | `{settings}`; validate HH:MM and timezone via `Intl.DateTimeFormat` |
| `POST /api/push/subscribe` | `PushSubscriptionJSON` | `{ok:true}` (upsert, enabled=true) |
| `POST /api/push/unsubscribe` | `{endpoint}` | `{ok:true}` (delete) |
| `POST /api/push/test` | — | sends a test push to all subscriptions; `{sent, failed, removed}`; 503 `{error}` if VAPID keys are missing |
| `GET or POST /api/cron` | header `Authorization: Bearer $CRON_SECRET` (NO session) | `{notified:boolean, reason, pending:n, sent?, failed?, removed?, error?}` |
| `GET /api/export.csv` | — | CSV of all entries; `date` column = the day the entry belongs to (night → wake day) |

## Reminder logic (`/api/cron`, called every 30 min by GitHub Actions)
0. If not set up (`initialized = false`) → do nothing (`reason:"not-set-up"`).
1. If now is inside the sleep window → do nothing (`reason:"sleeping"`).
2. Compute pending slots. If none → nothing (`"nothing-pending"`).
3. Let `latest` = most recent pending slot. If `latest.start != last_notified_slot`
   → notify (`"new-slot"`: "Log baby movement for 2:30–3:30 PM" — if >1 pending: "N hours to log, starting …"; for the sleep slot: "Good morning — log movement for the night").
   Else re-remind (`"re-remind"`: "Still waiting: N hour(s) to log") only if
   `last_notified_at` is at least 55 min ago (else `"recently-notified"`) AND the
   in-progress slot does not end within the next 15 min (else `"new-slot-soon"`:
   a new-slot push follows at the next run, so this avoids a double buzz). Exception:
   if the in-progress slot is followed by the sleep window, the re-remind is sent
   anyway (no new-slot push comes until morning).
4. Send to all subscriptions, then update last_notified_slot/at — unless every
   delivery failed (`reason:"push-failed"`; the next run retries). Subscriptions that
   return 404/410 are deleted; other failures (e.g. Apple 403 `BadJwtToken` after a
   VAPID key change) are logged and kept. Missing VAPID keys →
   `reason:"push-not-configured"`. Push problems never produce a 500.
Push payload JSON: `{title, body, url:"/", tag:"bm-reminder"}`.

The workflow (`.github/workflows/cron.yml`) retries only when curl could not reach
the server (DNS / connection refused / TLS handshake), never after a timeout or HTTP
error, since the server may already have sent the push.

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

**History**: grouped by local day (settings timezone; night → wake day, see "Day
attribution"), each day shows totals and a
row per slot (time label, K/R/O counts, "skipped" marker); tap row to edit
(steppers) or delete. Load last 14 days, "Load more". Link to export CSV.

**Settings**: sleep start/end (`<input type="time">`), timezone (prefilled from
`Intl.DateTimeFormat().resolvedOptions().timeZone`, select or text), Save.
Notifications section: status for this device, Enable/Disable, "Send test".
**Restart tracking from now** (confirm first; calls `POST /api/setup` with the device
timezone). Logout button.

**First run**: when `state.settings.initialized` is false, the app calls
`POST /api/setup {timezone: <device tz>}` automatically, then refetches state.

**Login**: 4-digit numeric input (`inputmode="numeric"`, `autocomplete="one-time-code"`), autosubmits on 4 digits. Shows the server's error text (including the 429 lockout message).

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

## Insights (v2)

New bottom-nav tab **Insights** (`/insights`) plus a printable **Doctor summary** (`/insights/summary`).
Nav becomes: Log · History · Insights · Settings.

### Settings: due date
- Column `due_date date` (nullable), added with `alter table settings add column if not exists due_date date`.
- `Settings.dueDate: string | null` ("YYYY-MM-DD"). `PUT /api/settings` accepts optional `dueDate` (string or null to clear); validate a real date within roughly −30 to +300 days of today.
- Pregnancy age = 280 days − (dueDate − today in settings tz). `{week, day}` = floor(days/7), days%7. Null if no due date or the result is outside 0..44 weeks.

### `GET /api/insights?days=28` (session required; days 7..120, default 28)
Day keys follow the existing rule: the night slot belongs to the day it ENDS; awake slots to the day they start (local, settings tz). Skipped entries count as 0 movements and as skipped hours.
```ts
type DayStat = {
  key: string;            // "YYYY-MM-DD"
  kicks: number; rolls: number; other: number; total: number;
  loggedHours: number;    // hours covered by non-skipped entries (night counts its real length)
  skippedHours: number;
  night: number | null;   // total of the night slot counted on this day (null if none/skipped)
};
type InsightsResponse = {
  now: string;
  settings: Settings;
  pregnancy: { week: number; day: number } | null;
  today: DayStat & {
    usualByNow: number | null; // mean total over the previous 7 days, counting only slots that ENDED by the same local time of day; days with < 50% of those hours logged are excluded; null if < 3 qualifying days
    usualDays: number;         // how many days went into usualByNow
    lowerThanUsual: boolean;   // usualByNow >= 10 && today.total < 0.5 * usualByNow && today's hours logged so far >= 50%
  };
  days: DayStat[];             // last `days` days, newest first, including today; days before tracking start omitted
  grid: { key: string; cells: (number | null)[]; future: boolean[]; nightFuture: boolean; night: number | null }[];
    // last 7 days newest first; cells[h] (0..23) = total of the awake slot whose local START hour is h; null when no entry or skipped.
    // future[h] (24 values) = true when the awake slot of that day starting at local hour h (current settings) hasn't ENDED yet
    // at `now` — the in-progress slot counts as future. Only today's row can have any; clients draw these blank, not as "not logged".
    // nightFuture = true when the night slot counted on that day hasn't ended yet (only possible for today, e.g. opened at 3 AM); drawn blank.
  hourAvg: (number | null)[];  // 24 values: average of non-null grid cells per hour over those 7 days
  weeks: { label: string; week: number | null; startKey: string; endKey: string; avgPerDay: number; days: number }[];
    // newest first, covering `days`. With a due date: grouped by pregnancy week, label "Week 31". Without: calendar weeks starting Monday, label "24 Nov".
};
```
Pure aggregation lives in `src/lib/insights.ts` (unit-tested); the route only loads entries + settings.

### UI
- **Insights tab** (top to bottom): pregnancy week header if set ("Week 31 + 2 days"); **Today vs usual** card (today's total so far with K/R/O, "usually N by this time", logged hours) and, when `lowerThanUsual`, a calm notice: "Fewer movements than usual so far. If you're worried, call your maternity unit now — don't wait." A static line is always shown at the bottom of the card: "There's no set number of movements. What matters is a change from your baby's usual pattern."; **Active hours** grid: rows = last 7 days (newest at top, short weekday label), one column per awake hourly slot only — in order from the wake time, e.g. wake 07:30 / sleep 23:30 → slots starting 7:30 … 22:30 (16 columns; equal sleep/wake times → 24) — sleep-window hours are not drawn; tick labels every 3 columns ("7a 10a 1p 4p 7p 10p") with a small gap between groups; cell shade by count (accent scale; 0 = pale filled cell; ended but not logged/skipped = outlined; not ended yet, incl. the slot in progress = blank), night total as a separate last column, average row at the bottom; every cell has an accessible label (day, slot start time, count / "not logged" / "not yet"); **Weekly** list: label, avg/day, small inline bar; link button "Doctor summary".
- **Doctor summary** `/insights/summary`: print-friendly (white background and the light palette even when the device is in dark mode, no nav; `@media print` hides buttons; in print the grid's 5 shades + "not logged" use grayscale-distinct fills, and each section's heading/caption/content is kept together), title, date range, due date / pregnancy week, a table of the last 28 days (date, kicks, rolls, other, total, night, "Log h", "Skip h"; under 420px wide the date drops the weekday ("Nov 26") and the type shrinks so all columns fit a 360px phone without sideways scrolling), weekly averages, the 7-day grid, flagged low days (day total < 50% of the mean of the previous 7 days with data), a "Print" button (`window.print()`), and a "Back" link.
- **Settings**: a "Due date" date input (optional, clearable), saved with the other settings.
- **Timezone names**: the client canonicalises IANA names before comparing or saving the device timezone — browsers may report legacy aliases (Chromium: "Asia/Calcutta"), which are mapped to the modern name ("Asia/Kolkata"); "Use this device's timezone" is only offered when the device zone differs from the saved one after canonicalisation.
