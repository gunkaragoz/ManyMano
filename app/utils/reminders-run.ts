// Reminder fan-out — shared by the HTTP endpoint (GET /api/reminders,
// manual/backfill use) and the Workers Cron Trigger (production sends,
// see workers/app.ts `scheduled`).
//
// Pure logic: no Request/Response, no auth. Two entry points:
// - runReminderFanout(): explicit date, sends unconditionally (manual tool).
// - runScheduledReminders(): hourly cron, sends only what's due — 9:00 AM
//   event-local, 24h ahead (organizers + participants) plus a 48h
//   understaffed alert (organizers of signup sheets with open spots).
//
// Dedupe (one reminder_sends row per event+date+kind) makes re-runs safe:
// retries never double-email; partial failures stay unmarked for next time.

import type { AppDb } from "~/db";
import type { D1Database } from "@cloudflare/workers-types";
import { getEmailSenderConfig, sendEmail, type EmailProvider } from "~/utils/email";
import { getEmailLimits, trackEmailUsage, type EmailLimits } from "~/utils/quota";
import {
  addDaysIso,
  buildMeetingOrganizerEmail,
  buildMeetingParticipantEmail,
  buildSignupOrganizerEmail,
  buildSignupParticipantEmail,
  collectReminderTargets,
  groupMeetingRecipients,
  groupSignupRecipients,
  isReminderSent,
  isUnderstaffed,
  LEGACY_ORGANIZER_KIND,
  markReminderSent,
  participantTasksForSignup,
  reminderInstant,
  targetReminderDate,
  type FinalizedMeetingTarget,
  type ReminderKind,
  type ReminderTarget,
  type SignupSheetTarget,
} from "~/utils/reminders";
import { normalizeTimezone } from "~/utils/validation";
import { isValidEmail } from "~/utils/validation";
import { resolveRetentionDays } from "~/utils/retention";
import type { SiteConfig } from "~/utils/site";

export type ReminderStatus = "sent" | "already-sent" | "skipped" | "failed" | "dry-run" | "no-recipients";

export interface EventReport {
  id: string;
  title: string;
  kind: "signup_sheet" | "finalized_meeting";
  organizer: ReminderStatus;
  organizer48h?: ReminderStatus;
  participants: { status: ReminderStatus; sent: number; failed: number };
}

/** Env keys the fan-out reads (subset of the worker env — no secrets). */
export interface ReminderFanoutEnv {
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_SECURE?: string;
  EMAIL_DAILY_LIMIT?: string;
  EMAIL_MONTHLY_LIMIT?: string;
  ALERT_WEBHOOK_URL?: string;
  RETENTION_DAYS?: string | number;
}

export interface ReminderRunResult {
  date: string;
  dryRun: boolean;
  totals: {
    events: number;
    organizerSent: number;
    organizer48hSent: number;
    participantSent: number;
    participantFailed: number;
  };
  events: EventReport[];
}

interface SenderCounters {
  organizerSent: number;
  organizer48hSent: number;
  participantSent: number;
  participantFailed: number;
}

interface SenderCtx {
  origin: string;
  nowIso: string;
  emailBase: ReturnType<typeof getEmailSenderConfig> & { from: string };
  track: (result: Parameters<typeof trackEmailUsage>[1]["result"]) => Promise<void>;
  counters: SenderCounters;
}

function makeSenderCtx(
  db: AppDb,
  d1: D1Database,
  site: SiteConfig,
  env: ReminderFanoutEnv
): Omit<SenderCtx, "counters"> {
  void db;
  const limits = (provider: EmailProvider): EmailLimits => getEmailLimits(provider, env);
  return {
    // Canonical links always point at SITE_URL (the caller's host — cron or
    // manual — is meaningless to participants).
    origin: site.siteUrl,
    nowIso: new Date().toISOString(),
    emailBase: { ...getEmailSenderConfig(env), from: site.fromEmail },
    track: async (result) => {
      await trackEmailUsage(d1, {
        webhookUrl: env.ALERT_WEBHOOK_URL,
        appName: site.siteName,
        result,
        limits: limits(result.provider),
      });
    },
  };
}

function newCounters(): SenderCounters {
  return { organizerSent: 0, organizer48hSent: 0, participantSent: 0, participantFailed: 0 };
}

async function sendOrganizer(
  db: AppDb,
  ctx: SenderCtx,
  target: SignupSheetTarget | FinalizedMeetingTarget,
  built: { subject: string; html: string },
  opts: { date: string; dryRun?: boolean; kind: ReminderKind; legacyKind?: ReminderKind }
): Promise<ReminderStatus> {
  const { date, kind, legacyKind } = opts;
  const dryRun = opts.dryRun ?? false;
  if (dryRun) return "dry-run";
  if (await isReminderSent(db, target.event.id, date, kind)) return "already-sent";
  if (legacyKind && (await isReminderSent(db, target.event.id, date, legacyKind))) return "already-sent";
  const to = (target.event.organizerEmail || "").trim();
  if (!to || !isValidEmail(to)) return "skipped";
  const result = await sendEmail({ ...ctx.emailBase, to, subject: built.subject, html: built.html });
  await ctx.track(result);
  if (!result.success) return "failed";
  await markReminderSent(db, target.event.id, date, kind, ctx.nowIso);
  if (kind === "organizer_48h") ctx.counters.organizer48hSent += 1;
  else ctx.counters.organizerSent += 1;
  return "sent";
}

async function sendParticipants(
  db: AppDb,
  ctx: SenderCtx,
  site: SiteConfig,
  target: SignupSheetTarget | FinalizedMeetingTarget,
  recipients: Array<{ email: string; name: string; slotIds?: string[] }>,
  opts: { date: string; dryRun: boolean }
): Promise<{ status: ReminderStatus; sent: number; failed: number }> {
  const { date, dryRun } = opts;
  if (dryRun) return { status: "dry-run", sent: 0, failed: 0 };
  if (await isReminderSent(db, target.event.id, date, "participants")) {
    return { status: "already-sent", sent: 0, failed: 0 };
  }
  if (recipients.length === 0) return { status: "no-recipients", sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    const built =
      target.kind === "signup_sheet"
        ? buildSignupParticipantEmail(
            site,
            ctx.origin,
            target,
            r.name,
            participantTasksForSignup(site, ctx.origin, target, r.slotIds ?? [])
          )
        : buildMeetingParticipantEmail(site, ctx.origin, target, r.name);
    const result = await sendEmail({ ...ctx.emailBase, to: r.email, subject: built.subject, html: built.html });
    await ctx.track(result);
    if (result.success) {
      sent += 1;
      ctx.counters.participantSent += 1;
    } else {
      failed += 1;
      ctx.counters.participantFailed += 1;
    }
  }
  // Mark only on full success so a partial failure retries the remainder
  // on the next run (at the cost of possible duplicates to the rest).
  if (failed === 0) {
    await markReminderSent(db, target.event.id, date, "participants", ctx.nowIso);
    return { status: "sent", sent, failed };
  }
  return { status: "failed", sent, failed };
}

/**
 * Manual/backfill entry: sends for an explicit event date unconditionally
 * (no due-gating — the caller chose the date). Used by GET /api/reminders.
 */
export async function runReminderFanout(
  db: AppDb,
  d1: D1Database,
  site: SiteConfig,
  env: ReminderFanoutEnv,
  opts: { date: string; dryRun: boolean }
): Promise<ReminderRunResult> {
  const { date, dryRun } = opts;
  const retentionDays = resolveRetentionDays(env);
  const ctx: SenderCtx = { ...makeSenderCtx(db, d1, site, env), counters: newCounters() };

  const reports: EventReport[] = [];
  const targets: ReminderTarget[] = await collectReminderTargets(db, date, retentionDays);
  for (const target of targets) {
    try {
      if (target.kind === "signup_sheet") {
        const organizer = await sendOrganizer(db, ctx, target, buildSignupOrganizerEmail(site, ctx.origin, target), {
          date,
          dryRun,
          kind: "organizer_24h",
          legacyKind: LEGACY_ORGANIZER_KIND,
        });
        const participants = await sendParticipants(db, ctx, site, target, groupSignupRecipients(target), {
          date,
          dryRun,
        });
        reports.push({ id: target.event.id, title: target.event.title, kind: target.kind, organizer, participants });
      } else {
        const organizer = await sendOrganizer(db, ctx, target, buildMeetingOrganizerEmail(site, ctx.origin, target), {
          date,
          dryRun,
          kind: "organizer_24h",
          legacyKind: LEGACY_ORGANIZER_KIND,
        });
        const participants = await sendParticipants(db, ctx, site, target, groupMeetingRecipients(target), {
          date,
          dryRun,
        });
        reports.push({ id: target.event.id, title: target.event.title, kind: target.kind, organizer, participants });
      }
    } catch {
      // One bad event (e.g. a failing D1 write) must not abort the run.
      reports.push({
        id: target.event.id,
        title: target.event.title,
        kind: target.kind,
        organizer: "failed",
        participants: { status: "failed", sent: 0, failed: 0 },
      });
    }
  }

  return {
    date,
    dryRun,
    totals: { events: reports.length, ...ctx.counters },
    events: reports,
  };
}

/**
 * Cron entry: sends only what's due as of `nowMs` — 9:00 AM event-local,
 * 24h ahead (organizers + participants) plus a 48h understaffed alert
 * (organizers of signup sheets with open spots). Idempotent via dedupe;
 * a missed hour just sends on the next run. Expired/undated events are
 * already excluded by collectReminderTargets.
 */
export async function runScheduledReminders(
  db: AppDb,
  d1: D1Database,
  site: SiteConfig,
  env: ReminderFanoutEnv,
  nowMs: number
): Promise<ReminderRunResult> {
  const ctx: SenderCtx = { ...makeSenderCtx(db, d1, site, env), counters: newCounters() };
  const retentionDays = resolveRetentionDays(env);
  const todayUtc = new Date(nowMs).toISOString().slice(0, 10);

  const reports: EventReport[] = [];
  const seen = new Set<string>();
  for (const offset of [0, 1, 2]) {
    const date = addDaysIso(todayUtc, offset);
    if (!date) continue;
    // eslint-disable-next-line no-await-in-loop
    const targets = await collectReminderTargets(db, date, retentionDays);
    for (const target of targets) {
      // A multi-day sheet matches several scan dates — one target per
      // occurrence — so dedupe on event + day, not the event alone.
      const eventDate = targetReminderDate(target);
      if (!eventDate) continue;
      if (seen.has(`${target.event.id}|${eventDate}`)) continue;
      seen.add(`${target.event.id}|${eventDate}`);
      const tz = normalizeTimezone(target.event.timezone);
      const due24At = reminderInstant(eventDate, 1, tz)?.getTime();
      const due48At = reminderInstant(eventDate, 2, tz)?.getTime();
      const due24 = due24At !== undefined && due24At <= nowMs;
      const due48 = due48At !== undefined && due48At <= nowMs;
      if (!due24 && !due48) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const report = await sendDueTarget(db, ctx, site, target, eventDate, { due24, due48 });
        reports.push(report);
      } catch {
        reports.push({
          id: target.event.id,
          title: target.event.title,
          kind: target.kind,
          organizer: "failed",
          participants: { status: "failed", sent: 0, failed: 0 },
        });
      }
    }
  }

  return {
    date: todayUtc,
    dryRun: false,
    totals: { events: reports.length, ...ctx.counters },
    events: reports,
  };
}

async function sendDueTarget(
  db: AppDb,
  ctx: SenderCtx,
  site: SiteConfig,
  target: ReminderTarget,
  eventDate: string,
  due: { due24: boolean; due48: boolean }
): Promise<EventReport> {
  let organizer: ReminderStatus = "skipped";
  let organizer48h: ReminderStatus | undefined;
  let participants: EventReport["participants"] = { status: "skipped", sent: 0, failed: 0 };

  if (due.due48 && target.kind === "signup_sheet" && isUnderstaffed(target)) {
    organizer48h = await sendOrganizer(
      db,
      ctx,
      target,
      buildSignupOrganizerEmail(site, ctx.origin, target, { horizon: "48h" }),
      { date: eventDate, kind: "organizer_48h" }
    );
  }
  if (due.due24) {
    if (target.kind === "signup_sheet") {
      organizer = await sendOrganizer(db, ctx, target, buildSignupOrganizerEmail(site, ctx.origin, target), {
        date: eventDate,
        kind: "organizer_24h",
        legacyKind: LEGACY_ORGANIZER_KIND,
      });
      participants = await sendParticipants(db, ctx, site, target, groupSignupRecipients(target), {
        date: eventDate,
        dryRun: false,
      });
    } else {
      organizer = await sendOrganizer(db, ctx, target, buildMeetingOrganizerEmail(site, ctx.origin, target), {
        date: eventDate,
        kind: "organizer_24h",
        legacyKind: LEGACY_ORGANIZER_KIND,
      });
      participants = await sendParticipants(db, ctx, site, target, groupMeetingRecipients(target), {
        date: eventDate,
        dryRun: false,
      });
    }
  }
  return { id: target.event.id, title: target.event.title, kind: target.kind, organizer, organizer48h, participants };
}
