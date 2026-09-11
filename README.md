# ManyMano 🤝

> An easy, ad-free tool for sign-up sheets and meeting time polls. No accounts — create and share in seconds. Free forever, open source. Built to run 100% free on **Cloudflare Pages & D1** with zero subscription costs.

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
- **Three-State Voting**: Available (`✔`), If need be (`(✔)`), or Unavailable (`–`).
- **Real-Time Consensus Highlighting**: Automatically identifies and badges the top-voted meeting slot.
- **Time Zone Smart**: View slots in local or event time zones.
- **1-Click Finalization**: Lock the winning meeting slot and trigger calendar invitations.

---

## 🚀 One-Click Deploy to Cloudflare

ManyMano is architected to fit comfortably inside **Cloudflare's Free Tier**:
- **Cloudflare Pages & Workers**: 100,000 requests/day, tiny <100KB worker bundle.
- **Cloudflare D1 (SQLite)**: 5,000,000 reads/day, 100,000 writes/day, 5GB storage.
- **Resend Transactional Email**: 3,000 free emails/month.

### Step 1: Deploy with Git
1. Click the **[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/gunkaragoz/ManyMano)** button above.
2. Connect your GitHub account and fork the repository.

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

### Step 4 (Optional): Configure Email
In your Cloudflare Pages project settings, add an environment variable:
- `RESEND_API_KEY`: Your API key from [resend.com](https://resend.com).
*(If omitted, ManyMano continues to work smoothly using direct in-browser `.ics` calendar downloads and direct tokenized links!)*

---

## 💻 Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Run local D1 migrations
pnpm run db:migrate:local

# 3. Start local development server
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🛠️ Tech Stack

- **Framework**: [Remix / React Router v7](https://remix.run/) with Vite
- **Edge Runtime**: [Cloudflare Pages & Workers](https://developers.cloudflare.com/pages/)
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless edge SQLite)
- **ORM & Migrations**: [Drizzle ORM](https://orm.drizzle.team/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Calendar**: Edge-native RFC 5545 `.ics` generator
- **Email**: [Resend](https://resend.com/) with graceful offline fallback

---

## 📄 License

MIT License. Free for personal, non-profit, community, and commercial use.
