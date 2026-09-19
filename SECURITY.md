# Security Policy

## Supported Versions

ManyMano is in active development. Only the latest `main` branch is supported
with security updates.

| Version | Supported          |
| ------- | ------------------ |
| `main` (latest) | :white_check_mark: |
| Older commits / forks pinned to a tag | :x: — please update to latest `main` first |

There are no LTS releases. If you deployed via
[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/gunkaragoz/ManyMano)
or forked the repo, rebase / redeploy to pick up fixes.

## Reporting a Vulnerability

**Please do not open a public issue for a suspected vulnerability.**

Report privately via one of these channels:

1. **GitHub Security Advisories (preferred):**
   https://github.com/gunkaragoz/ManyMano/security/advisories/new
2. **Fallback:** open a regular issue at
   https://github.com/gunkaragoz/ManyMano/issues
   **only** if it contains no exploit details — just ask for a private
   contact channel.

Include in your report:

- Description of the vulnerability and its impact
- Steps to reproduce (URLs, payloads, config)
- Affected commit / deployment date, if known
- Your `wrangler.toml` `[vars]` (redact secrets) if config-related
- Optional: suggested fix or patch

### What to expect

- Acknowledgement within **72 hours**.
- An initial assessment / triage within **7 days**.
- Fixes are shipped to `main` as soon as they are ready; there is no fixed
  SLA for complex issues, but critical remote-code-execution / data-exposure
  issues are prioritized.
- You will be credited in the fix commit / advisory unless you ask to stay
  anonymous.
- This is a community-run open-source project with no bug-bounty program —
  please do not expect monetary rewards.

## Scope

In scope:

- `app/` — React Router frontend + route actions / loaders
- `workers/` — Cloudflare Workers entry, API routes, cron reminders
- `drizzle/` — D1 schema / migrations
- Auth model: tokenized admin / participant links, hashed secrets,
  HttpOnly admin cookie
- Email paths: Resend / SMTP, reminder cron, `.ics` generation
- Bot abuse bypasses (Turnstile), rate-limit / quota exhaustion,
  stored XSS via event / attendee fields, CSV export access control

Out of scope:

- Cloudflare, Resend, SMTP provider, or browser vulnerabilities
  (report those upstream)
- Social engineering, physical attacks, DDoS volume testing
- Reports that require a misconfigured deployment to exploit
  (e.g. secrets committed to git, `REMINDER_SECRET` left empty on a
  public instance) — see hardening notes below
- Scanner output without a working proof of concept

## Responsible Disclosure

- Do not access other users' events, exfiltrate data, or degrade the service.
- Do not send reminder / quota-burn emails to anyone but test addresses
  you control (`?dry-run=1` on `GET /api/reminders` is safe to probe).
- Delete any test data you create.
- Give us reasonable time to fix before any public disclosure, and do not
  disclose exploit details until a fix is deployed.

## If You Operate a Deployment

You are responsible for your own instance. Minimum hardening:

- **Never commit secrets.** Plaintext vars live in `wrangler.toml`
  (`[vars]`), secrets via `wrangler secret put`
  (`RESEND_API_KEY`, `SMTP_PASSWORD`, `TURNSTILE_SECRET_KEY`,
  `REMINDER_SECRET`, …). `.dev.vars` / `.env` are gitignored —
  keep them that way. See `.env.sample`.
- **Set every required var** (`SITE_URL`, `SITE_NAME`, `FROM_EMAIL`,
  etc.). The app fail-fasts on missing config so forks can't silently
  serve stale defaults.
- **Enable Turnstile in production** (`TURNSTILE_SITE_KEY` +
  `TURNSTILE_SECRET_KEY` + `TURNSTILE_HOSTNAMES`). Empty secret =
  verification skipped (local-dev passthrough only).
- **Set `REMINDER_SECRET`** if you expose `GET /api/reminders`.
  Empty = fail-closed `503`, so an open endpoint can't burn your
  email quota.
- **Set `EMAIL_DAILY_LIMIT` / `EMAIL_MONTHLY_LIMIT`** to your real
  provider quota and configure `ALERT_WEBHOOK_URL` (Discord/Slack)
  so 80/90/100% alerts fire.
- **Run migrations after every pull:**
  `npx wrangler d1 migrations apply manymano-db --remote`.
- Treat organizer admin links as passwords: anyone holding the link
  (or the HttpOnly admin cookie) has full control of that event,
  including roster CSV export and deletion.

## Security Contacts & Feeds

- `SECURITY_CONTACT` env var (see `.env.sample`) feeds `/.well-known/security.txt`.
  Default: `https://github.com/gunkaragoz/ManyMano/issues`.
- This file (`SECURITY.md`) is the canonical policy. If they ever
  disagree, this file wins.
