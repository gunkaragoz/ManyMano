# ManyMano 🤝

> A privacy-first, ad-free, open-source tool for volunteer sign-ups and meeting time polls. Built to run 100% free on **Cloudflare Pages & D1** with zero subscription costs.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/manymano/manymano)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## ✨ Features

### 📋 1. Volunteer & Slot Sign-Ups
- **Slot Limits & Capacity Tracking**: Define slots with exact headcount limits (e.g. 2 volunteers) or unlimited capacity.
- **Race-Condition Protected**: Atomic D1 transactions prevent overbooking.
- **Custom Attendee Notes**: Collect volunteer comments, t-shirt sizes, dietary restrictions, or equipment notes.
- **Instant Calendar Invites**: Direct RFC 5545 `.ics` file generation right at the edge—no email mandatory.
- **Zero Login Barrier**: Participants sign up in 5 seconds with name & optional email.
- **Private Edit Links**: Volunteers can cancel or adjust their own entries using secure tokens.
- **Organizer Admin Mode**: Access attendance rosters, export CSV spreadsheets, and manage volunteers using secret organizer tokens.

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
1. Click the **[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/manymano/manymano)** button above.
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
