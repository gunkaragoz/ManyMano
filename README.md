# ManyMano 🤝

> An easy, ad-free tool for sign-up sheets and meeting time polls. No accounts — create and share in seconds. Free to use, open source. Built to run 100% free on **Cloudflare Workers & D1** with zero subscription costs.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/gunkaragoz/ManyMano)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## ✨ Features

### 📋 1. Sign-Up Sheets
- **Slot Limits & Capacity Tracking**: Define slots with exact headcount limits (e.g. 2 spots) or unlimited capacity.
- **Overbooking Guard**: Transactional capacity re-check on sign-up.
- **Custom Attendee Notes**: Collect participant comments or equipment notes (kept to 500 chars, visible to link holders).
- **Instant Calendar Invites**: Direct RFC 5545 `.ics` file generation right at the edge—no email mandatory. Organizer email is omitted from public calendar files.
- **Zero Login Barrier**: Participants sign up in 5 seconds with name & optional email.
- **Private Edit Links**: Participants who share an email get a cancel link; organizers can remove anyone.
- **Organizer Admin Mode**: Attendance rosters, CSV export (organizer-only), and full event delete. Admin link upgrades to an HttpOnly cookie and secrets are stored hashed.
- **No accounts needed**: Participants sign up in seconds with name & optional email; organizers can delete anytime.

### 📅 2. Meeting Time Finder
- **Consensus Matrix Grid**: Multi-candidate date and time options displayed in a responsive grid.
- **Three-State Voting**: Available (`✔`), Maybe (`(✔)`), or Unavailable (`–`).
- **Real-Time Consensus Highlighting**: Automatically identifies and badges the top-voted meeting slot.
- **Time Zone Smart**: View slots in local or event time zones.
- **1-Click Finalization**: Lock the winning meeting slot and trigger calendar invitations.

---

## 🚀 One-Click Deploy to Cloudflare

ManyMano is architected to fit comfortably inside **Cloudflare's Free Tier**:
- **Cloudflare Workers**: 100,000 requests/day, tiny worker bundle.
- **Cloudflare D1 (SQLite)**: 5,000,000 reads/day, 100,000 writes/day, 5GB storage.
- **Resend Transactional Email**: 3,000 free emails/month (default provider).
- **SMTP / Amazon SES**: switch `EMAIL_PROVIDER` to `smtp` for higher volume via any SMTP server, including SES.

### Step 1: Deploy the Worker
```bash
pnpm install
pnpm run deploy   # typecheck + build + tests + wrangler deploy
```
This creates the `manymano` Worker (production). Point your domain at it
via `[[env.production.routes]]` in `wrangler.toml`, or add a custom domain
in the dashboard (Workers & Pages → manymano → Settings → Domains & Routes).

Want a staging copy first? See `deploy:staging` (isolated worker + D1,
no mail creds, no cron) and `tests/staging/`.

### Step 2: Create your free D1 Database
In your Cloudflare dashboard (or via terminal with `npx wrangler`):
```bash
# Create the D1 database
npx wrangler d1 create manymano-db
```
Paste the returned `database_id` into your `wrangler.toml`.

### Step 3: Run Migrations
```bash
npx wrangler d1 migrations apply manymano-db --remote
```

### Step 4 (Required): Configure branding, domain & email
Plaintext vars live in `wrangler.toml` (`[vars]` for production,
`[env.staging.vars]` for staging); secrets via `wrangler secret put`
(see `.env.sample` for which keys are which). Set **every** variable from
`.env.sample` — the app throws at request time
when any is missing (no hardcoded fallbacks, so a fork can never silently
serve the old defaults):
- `SITE_URL`, `SITE_NAME`, `SITE_TAGLINE`, `SITE_DESCRIPTION`
- `FROM_EMAIL` (e.g. `YourName <no-reply@mail.yourdomain.com>`)
- `SECURITY_CONTACT`, `ICS_UID_DOMAIN`, `ICS_PRODID`

Optional branding (leave empty/unset to hide — no throw):
- `GITHUB_REPO_URL` (footer GitHub icon, Organization JSON-LD `sameAs`, llms.txt)
- `FOOTER_CREDIT_URL` + `FOOTER_CREDIT_LABEL` (footer credit link, shown only when both are set)

### Step 5 (Optional): Configure integrations
- `EMAIL_PROVIDER`: `resend` (default) or `smtp`.
- `RESEND_API_KEY`: Your API key from [resend.com](https://resend.com).
*(If omitted, ManyMano continues to work smoothly using direct in-browser `.ics` calendar downloads and direct tokenized links!)*
- SMTP (`EMAIL_PROVIDER="smtp"`): `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` (+ optional `SMTP_SECURE`). Works with any SMTP server, including Amazon SES via its SMTP endpoint (e.g. `email-smtp.eu-central-1.amazonaws.com:587` with SES SMTP credentials) when traffic outgrows Resend free. Notes: Workers blocks port 25 (use 587/465); SMTP sends need the Workers runtime (`pnpm run dev` or deployed).
- `EMAIL_DAILY_LIMIT` / `EMAIL_MONTHLY_LIMIT`: override the quota-alert baselines for your SMTP/SES limits (defaults: Resend 100/day + 3,000/month; SMTP 50,000/day + 1,500,000/month).
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` / `TURNSTILE_HOSTNAMES`: Cloudflare Turnstile bot protection. If the secret is omitted, verification is skipped (handy for local dev).
- `ALERT_WEBHOOK_URL`: Discord or Slack incoming webhook for quota alerts. Every sent email is counted in D1 (UTC day/month); one webhook fires at 80/90/100% of the active provider quota (see above) and on Resend 429 exhaustion. `GET /api/usage` always shows the live counters. Cloudflare itself emails the account owner at ~90% of Workers/D1 daily limits — no setup needed.
- Day-before reminder emails run on the Worker's Cron Trigger (hourly scan, `[triggers]` in `wrangler.toml` — production only). Sends fire at 9:00 AM in the event's timezone: organizers + participants 24h ahead, plus a 48h understaffed alert for organizers of sheets with open spots. `GET /api/reminders` remains for manual dry-runs/backfills (`?dry-run=1`, `?date=YYYY-MM-DD`) authenticated by `REMINDER_SECRET`; re-runs are deduped per event+date so retries never double-email.

### Step 6: Apply migrations after pulling
```bash
npx wrangler d1 migrations apply manymano-db --remote   # production
pnpm run db:migrate:local                               # local dev
```

---

## 💻 Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Copy the env template (required — the app fail-fasts on missing vars)
cp .env.sample .dev.vars
# Then set SITE_URL in .dev.vars to your local URL. The dev server port
# follows SITE_URL automatically — just run `pnpm run dev` and open it.

# 3. Run local D1 migrations
pnpm run db:migrate:local

# 4. Start local development server
pnpm run dev
```

Open the URL from your `.dev.vars` `SITE_URL` in your browser (the dev server port follows it automatically).

---

## 🛠️ Tech Stack

- **Framework**: [React Router 8](https://reactrouter.com/) + [React 19](https://react.dev/) (SSR on the edge)
- **Build**: [Vite 8](https://vite.dev/) + [@cloudflare/vite-plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- **Edge Runtime**: [Cloudflare Workers](https://developers.cloudflare.com/workers/) (fetch handler + hourly [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) for reminder emails)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless edge SQLite)
- **ORM & Migrations**: [Drizzle ORM](https://orm.drizzle.team/) + Drizzle Kit
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + [Lucide](https://lucide.dev/) icons
- **Calendar**: Edge-native RFC 5545 `.ics` generator
- **Email**: [Resend](https://resend.com/) (default) or generic SMTP incl. Amazon SES via `worker-mailer`, with graceful offline fallback
- **Bot Protection**: [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
- **QR Codes**: Server-rendered event share codes via `qrcode`

---

## 📄 License

MIT License. Free for personal, non-profit, community, and commercial use.
