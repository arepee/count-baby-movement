# Baby Movement ("Kicks")

A small installable web app (PWA) for logging fetal movement every hour: kicks, rolls
and other movements. It sends a push notification to the phone each hour while you're
awake, keeps nagging until every past hour is logged, and asks for one entry covering
the whole night when you wake up.

Stack: Next.js 15 on Vercel, Neon Postgres, Web Push (VAPID), GitHub Actions as the
hourly scheduler. One user, protected by a 4-digit code.

## Deploy

1. **Push the repo to GitHub, import it in Vercel.** vercel.com → Add New → Project →
   pick the repo. Defaults are fine. The first deploy may fail until env vars exist;
   that's OK.
2. **Add a database.** In the Vercel project: Storage → Create / Connect → Neon
   (Marketplace). Connect it to the project; this sets `DATABASE_URL` for you. Tables
   are created automatically on first request (or run `npm run db:migrate` locally with
   `DATABASE_URL` set).
3. **Generate secrets** locally:
   ```sh
   npm install
   npm run vapid
   ```
   Paste the output into Vercel → Settings → Environment Variables, plus:
   - `APP_CODE`: your 4-digit login code
   - `VAPID_SUBJECT`: `mailto:` your email
   
   See [`.env.example`](.env.example) for the full list. Redeploy after adding vars.
4. **Set up the reminder cron.** GitHub repo → Settings → Secrets and variables →
   Actions → New repository secret:
   - `APP_URL`: e.g. `https://your-app.vercel.app` (no trailing slash)
   - `CRON_SECRET`: same value as in Vercel
   
   Make sure Actions are enabled (Actions tab), then open **Reminder cron** → Run
   workflow to test. A green run means `/api/cron` accepted the token; the log shows
   the JSON response.
5. **Install on the iPhone** (iOS 16.4 or newer):
   1. Open the app URL in **Safari**.
   2. Share → **Add to Home Screen**.
   3. Open it **from the home screen icon** (not from Safari).
   4. Enter the code.
   5. Tap **Enable notifications** and allow. Use "Send test" in Settings to confirm.

   Notifications on iOS only work in the home-screen app, never in a Safari tab.

## How reminders work

- The day is split into 1-hour slots anchored to your wake time (default 07:30 →
  07:30–08:30, 08:30–09:30, …). The sleep window (default 23:30–07:30) is a single slot.
- GitHub Actions calls `/api/cron` every 30 minutes. When an hour has ended and isn't
  logged, you get a notification. If it's still not logged ~an hour later, you get
  another ("Still waiting: N hours to log"). It keeps nagging until the backlog is clear.
- No notifications during the sleep window. On waking you get one prompt to log the
  whole night as a single entry.
- The Log screen makes you clear past hours oldest first. For each one: enter counts and
  **Save**, or tap **Didn't track** to skip it. At most the last 72 open hours are shown.
- History lets you edit or delete entries and export CSV.

## Settings

In the app's Settings screen: sleep start/end, timezone (defaults to the phone's),
notifications on/off for this device, "Send test", and log out.

## Local development

```sh
cp .env.example .env.local   # fill in DATABASE_URL at minimum (a Neon dev branch works)
npm install
npm run dev                  # http://localhost:3000
npm test                     # unit tests (vitest)
```

Push needs the VAPID vars and works on localhost in desktop Chrome/Firefox. To trigger
the reminder logic by hand:
```sh
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
```

Other scripts: `npm run vapid` (new secrets), `npm run db:migrate` (apply schema),
`npm run icons` (regenerate icons from `scripts/gen-icons.mjs`, needs Playwright).

## Troubleshooting

- **No notifications on iPhone**
  - iOS 16.4+ required, and the app must be opened from the home screen icon.
  - iPhone Settings → Notifications → Kicks: make sure Allow Notifications is on.
  - Press "Send test" in Settings. If the test works but reminders don't, check the
    GitHub Action runs (step 4) and that `CRON_SECRET` matches in both places.
  - If you changed the VAPID keys or reinstalled the app, tap Disable then Enable
    notifications again.
- **Focus modes / Sleep Focus** silence notifications. Allow "Kicks" in the Focus
  settings if you want reminders to break through.
- **Reminders arrive late.** GitHub's scheduler is best-effort; runs are often 5–15+
  minutes late, occasionally skipped. That's why it polls every 30 minutes.
- **Reminders stopped completely.** GitHub disables scheduled workflows after 60 days
  without repository activity. Actions tab → Reminder cron → Enable workflow (or push
  any commit).
- **Private repo Actions minutes.** Every-30-min runs use ~1440 billed minutes/month
  (GitHub Free includes 2000 for private repos; public repos are free). Change the cron
  in `.github/workflows/cron.yml` to `0 * * * *` to halve it.
- **Workflow fails with 401.** `CRON_SECRET` differs between GitHub and Vercel, or
  Vercel wasn't redeployed after setting it.
