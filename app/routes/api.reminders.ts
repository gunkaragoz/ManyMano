import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data } from "react-router";
import { getDb } from "~/db";
import { getEmailSenderConfig, sendEmail } from "~/utils/email";
import { getEmailLimits, trackEmailUsage } from "~/utils/quota";
import { safeEqual } from "~/utils/auth";
import { isValidEmail, isValidIsoDate } from "~/utils/validation";
import { getSiteConfig } from "~/utils/site";
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
  reminderDateString,
  type FinalizedMeetingTarget,
  type ReminderTarget,
  type SignupSheetTarget,
} from "~/utils/reminders";

// GET /api/reminders — day-before reminder fan-out (cron entry point).
//
// Cloudflare Pages Functions have no native cron trigger, so an external
// scheduler calls this endpoint once a day (see REMINDER_SECRET in
// .env.sample + .github/workflows/reminders.yml):
//   GET /api/reminders  (Authorization: Bearer <REMINDER_SECRET>)
//
// Query params:
//   ?secret=...   alternative to the Authorization header (for cron
//                 services that can't set headers — prefer the header).
//   ?date=YYYY-MM-DD  override "tomorrow" (testing/backfill).
//   ?dry-run=1    report what would be sent without sending or recording.
//
// Auth: REMINDER_SECRET is required. When unset the endpoint answers 503
// (fail-closed — an open reminder endpoint would let anyone burn the
// email quota). Comparison is timing-safe.
//
// Dedupe: one reminder_sends row per (event, date, kind); re-runs skip
// already-sent kinds, so retries never double-email. Partial failures are
// left unmarked so the next run retries them.

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers();
  const cacheControl = loaderHeaders.get("Cache-Control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return headers;
};

type ReminderStatus = "sent" | "already-sent" | "skipped" | "failed" | "dry-run" | "no-recipients";

interface EventReport {
  id: string;
  title: string;
  kind: "signup_sheet" | "finalized_meeting";
  organizer: ReminderStatus;
  participants: { status: ReminderStatus; sent: number; failed: number };
}

function isAuthorized(request: Request, secret: string): boolean {
  const url = new URL(request.url);
  const querySecret = (url.searchParams.get("secret") ?? "").trim();
  const header = (request.headers.get("authorization") ?? "").trim();
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  // safeEqual is timing-safe for equal-length inputs and false otherwise.
  if (querySecret && safeEqual(querySecret, secret)) return true;
  if (bearer && safeEqual(bearer, secret)) return true;
  return false;
}

interface ReminderEnv {
  DB: D1Database;
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
  REMINDER_SECRET?: string;
  FROM_EMAIL: string;
  SITE_URL: string;
  SITE_NAME: string;
  SITE_TAGLINE: string;
  SITE_DESCRIPTION: string;
  GITHUB_REPO_URL?: string;
  FOOTER_CREDIT_URL?: string;
  FOOTER_CREDIT_LABEL?: string;
  SECURITY_CONTACT?: string;
  ICS_UID_DOMAIN?: string;
  ICS_PRODID?: string;
}

async function handleReminders(request: Request, env: ReminderEnv) {
  const site = getSiteConfig(env);
  const db = getDb(env.DB);
  const nowIso = new Date().toISOString();
  // Canonical links: the cron caller host is meaningless, so reminders
  // always point at SITE_URL (same origin participants signed up from).
  const origin = site.siteUrl;

  const secret = (env.REMINDER_SECRET ?? "").trim();
  if (!secret) {
    return data(
      { error: "Reminder endpoint is not configured (set REMINDER_SECRET). See .env.sample." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  if (!isAuthorized(request, secret)) {
    return data({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry-run") === "1";
  const dateRaw = (url.searchParams.get("date") ?? "").trim();
  let date = reminderDateString();
  if (dateRaw) {
    if (!isValidIsoDate(dateRaw)) {
      return data(
        { error: "Invalid ?date= — use YYYY-MM-DD." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    date = dateRaw;
  }

  let targets: ReminderTarget[];
  try {
    targets = await collectReminderTargets(db, date);
  } catch {
    return data(
      { error: "Could not load reminder targets." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const emailBase = { ...getEmailSenderConfig(env), from: site.fromEmail };
  const limits = (provider: "resend" | "smtp") => getEmailLimits(provider, env);
  const track = (result: Parameters<typeof trackEmailUsage>[1]["result"]) =>
    trackEmailUsage(env.DB, {
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

  return data(
    {
      ok: true,
      date,
      dryRun,
      totals: {
        events: reports.length,
        organizerSent,
        participantSent,
        participantFailed,
      },
      events: reports,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as unknown as ReminderEnv;
  return handleReminders(request, env);
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as unknown as ReminderEnv;
  return handleReminders(request, env);
}
