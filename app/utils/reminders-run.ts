// Day-before reminder fan-out core — shared by the HTTP endpoint
// (GET /api/reminders, manual/backfill use) and the Workers Cron Trigger
// (daily production sends, see workers/app.ts `scheduled`).
//
// Pure logic: no Request/Response, no auth. Callers resolve `date`
// (default: tomorrow via reminderDateString()) and `dryRun` themselves.
// Dedupe (one reminder_sends row per event+date+kind) makes re-runs safe:
// retries never double-email; partial failures stay unmarked for next time.

import type { AppDb } from "~/db";
import type { D1Database } from "@cloudflare/workers-types";
import { getEmailSenderConfig, sendEmail, type EmailProvider } from "~/utils/email";
import { getEmailLimits, trackEmailUsage, type EmailLimits } from "~/utils/quota";
import {
  buildMeetingOrganizerEmail,
  buildMeetingParticipantEmail,
  buildSignupOrganizerEmail,
  buildSignupParticipantEmail,
  collectReminderTargets,
  groupMeetingRecipients,
  groupSignupRecipients,
  isReminderSent,
  markReminderSent,
  participantTasksForSignup,
  type FinalizedMeetingTarget,
  type ReminderTarget,
  type SignupSheetTarget,
} from "~/utils/reminders";
import { isValidEmail } from "~/utils/validation";
import type { SiteConfig } from "~/utils/site";

export type ReminderStatus = "sent" | "already-sent" | "skipped" | "failed" | "dry-run" | "no-recipients";

export interface EventReport {
  id: string;
  title: string;
  kind: "signup_sheet" | "finalized_meeting";
  organizer: ReminderStatus;
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
}

export interface ReminderRunResult {
  date: string;
  dryRun: boolean;
  totals: { events: number; organizerSent: number; participantSent: number; participantFailed: number };
  events: EventReport[];
}

export async function runReminderFanout(
  db: AppDb,
  d1: D1Database,
  site: SiteConfig,
  env: ReminderFanoutEnv,
  opts: { date: string; dryRun: boolean }
): Promise<ReminderRunResult> {
  const { date, dryRun } = opts;
  const nowIso = new Date().toISOString();
  // Canonical links always point at SITE_URL (the caller's host — cron or
  // manual — is meaningless to participants).
  const origin = site.siteUrl;

  const emailBase = { ...getEmailSenderConfig(env), from: site.fromEmail };
  const limits = (provider: EmailProvider): EmailLimits => getEmailLimits(provider, env);
  const track = (result: Parameters<typeof trackEmailUsage>[1]["result"]) =>
    trackEmailUsage(d1, {
      webhookUrl: env.ALERT_WEBHOOK_URL,
      appName: site.siteName,
      result,
      limits: limits(result.provider),
    });

  const reports: EventReport[] = [];
  let organizerSent = 0;
  let participantSent = 0;
  let participantFailed = 0;

  const sendOrganizer = async (
    target: SignupSheetTarget | FinalizedMeetingTarget,
    built: { subject: string; html: string }
  ): Promise<ReminderStatus> => {
    if (dryRun) return "dry-run";
    if (await isReminderSent(db, target.event.id, date, "organizer")) return "already-sent";
    const to = (target.event.organizerEmail || "").trim();
    if (!to || !isValidEmail(to)) return "skipped";
    const result = await sendEmail({ ...emailBase, to, subject: built.subject, html: built.html });
    await track(result);
    if (!result.success) return "failed";
    await markReminderSent(db, target.event.id, date, "organizer", nowIso);
    organizerSent += 1;
    return "sent";
  };

  const sendParticipants = async (
    target: SignupSheetTarget | FinalizedMeetingTarget,
    recipients: Array<{ email: string; name: string; slotIds?: string[] }>
  ): Promise<{ status: ReminderStatus; sent: number; failed: number }> => {
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
              origin,
              target,
              r.name,
              participantTasksForSignup(site, origin, target, r.slotIds ?? [])
            )
          : buildMeetingParticipantEmail(site, origin, target, r.name);
      const result = await sendEmail({ ...emailBase, to: r.email, subject: built.subject, html: built.html });
      await track(result);
      if (result.success) {
        sent += 1;
        participantSent += 1;
      } else {
        failed += 1;
        participantFailed += 1;
      }
    }
    // Mark only on full success so a partial failure retries the remainder
    // on the next run (at the cost of possible duplicates to the rest).
    if (failed === 0) {
      await markReminderSent(db, target.event.id, date, "participants", nowIso);
      return { status: "sent", sent, failed };
    }
    return { status: "failed", sent, failed };
  };

  const targets: ReminderTarget[] = await collectReminderTargets(db, date);
  for (const target of targets) {
    try {
      if (target.kind === "signup_sheet") {
        const organizer = await sendOrganizer(target, buildSignupOrganizerEmail(site, origin, target));
        const participants = await sendParticipants(target, groupSignupRecipients(target));
        reports.push({ id: target.event.id, title: target.event.title, kind: target.kind, organizer, participants });
      } else {
        const organizer = await sendOrganizer(target, buildMeetingOrganizerEmail(site, origin, target));
        const participants = await sendParticipants(target, groupMeetingRecipients(target));
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
    totals: { events: reports.length, organizerSent, participantSent, participantFailed },
    events: reports,
  };
}
