// Organizer email added (or changed) from admin mode.
//
// Events can exist with no organizer email (created by an agent over MCP,
// where nothing is mailed). Saving one here gives the organizer a backup of
// their private link and makes "Lost your organizer link?" work.
//
// The admin token alone is not trusted to send mail: anyone can mint one by
// creating an event, so a changed address needs Turnstile whenever mail is
// configured, plus a per-IP and a durable per-event rate limit.
//
// The route wires real IO into `saveOrganizerEmail`; tests pass fakes.

import { emailFooter, type SendEmailResult } from "./email";
import { escapeHtml } from "./sanitize";
import { EMAIL_MAX, isValidEmail } from "./validation";
import type { GuestAssessment } from "./bot-protection";
import { turnstileFailure } from "./turnstile";

/** Durable cap on address changes per event per UTC hour (all IPs). */
export const ORGANIZER_EMAIL_CHANGES_PER_HOUR = 5;

export const EMAIL_SAVED_AND_SENT = "Email saved. Your organizer link is on its way.";
export const EMAIL_SAVED_NOT_SENT =
  "Email saved, but we couldn't send the backup. Keep your organizer link.";
export const EMAIL_ALREADY_SAVED = "Email already saved.";

export function parseOrganizerEmailInput(
  raw: unknown
): { ok: true; email: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Please enter an email address." };
  const email = raw.trim();
  // Reject rather than truncate: a clipped address is a different address.
  if (email.length > EMAIL_MAX) return { ok: false, error: "That email address is too long." };
  if (!email) return { ok: false, error: "Please enter an email address." };
  if (!isValidEmail(email)) return { ok: false, error: "Please enter a valid email address." };
  return { ok: true, email };
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** Hour bucket for the durable per-event limit, e.g. `setemail:abc:2026-09-27T14`. */
export function organizerEmailLimitKey(eventId: string, now: Date): string {
  return `setemail:${eventId}:${now.toISOString().slice(0, 13)}`;
}

export function organizerLinks(siteUrl: string, eventId: string, adminToken: string) {
  const publicUrl = `${siteUrl}/events/${eventId}`;
  return {
    publicUrl,
    adminUrl: `${publicUrl}?admin=${encodeURIComponent(adminToken)}`,
    qrUrl: `${publicUrl}/qr?format=png`,
  };
}

export function buildOrganizerLinkEmail(args: {
  site: { siteName: string; siteTagline: string; siteUrl: string };
  title: string;
  organizerName: string | null | undefined;
  isPoll: boolean;
  publicUrl: string;
  adminUrl: string;
  qrUrl: string;
}): { subject: string; html: string } {
  const kind = args.isPoll ? "poll" : "sign-up sheet";
  const people = args.isPoll ? "voters" : "participants";
  return {
    subject: `Your organizer link: "${args.title}"`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0;">Your organizer link for "${escapeHtml(args.title)}"</h2>
        <p>Hi ${escapeHtml(args.organizerName || "organizer")},</p>
        <p>This email address was saved as the organizer of this ${kind}. Keep this message as a backup of your private link.</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 18px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 0 0 12px 0;"><strong>Public link for ${people}:</strong><br><a href="${escapeHtml(args.publicUrl)}" style="color: #2563eb;">${escapeHtml(args.publicUrl)}</a></p>
          <p style="margin: 0;"><strong>Secret organizer link (keep private):</strong><br><a href="${escapeHtml(args.adminUrl)}" style="color: #2563eb;">${escapeHtml(args.adminUrl)}</a></p>
        </div>
        <div style="text-align: center; margin: 20px 0;">
          <a href="${escapeHtml(args.publicUrl)}"><img src="${escapeHtml(args.qrUrl)}" alt="QR code linking to your event page" width="160" height="160" style="width: 160px; height: 160px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 6px; background: #ffffff;" /></a>
        </div>
        <p style="font-size: 13px; color: #64748b;">If you didn't expect this, someone with the organizer link entered your address. If you lose the link, use "Lost your organizer link?" on the event page to get a new one.</p>
        ${emailFooter(args.site)}
      </div>
    `,
  };
}

export type SaveOrganizerEmailOutcome =
  | { status: 200; body: { success: true; message: string } }
  | { status: 400 | 403 | 429 | 500 | 503; body: { error: string; needsVerification?: boolean } };

export interface SaveOrganizerEmailDeps {
  isSameOrigin: () => boolean;
  requireAdmin: () => Promise<boolean>;
  /** Honeypot + time trap (+ per-isolate guest limit). */
  assessBot: () => GuestAssessment;
  mailConfigured: boolean;
  turnstileConfigured: boolean;
  /** Per IP+event, per isolate. */
  ipRateLimitOk: () => boolean;
  /** Durable per-event admission. Throws when storage is unavailable. */
  reserveEventChange: () => Promise<boolean>;
  verifyTurnstile: () => Promise<boolean>;
  saveEmail: (email: string) => Promise<void>;
  budgetAvailable: () => Promise<boolean>;
  sendLinkEmail: (email: string) => Promise<SendEmailResult>;
  trackUsage: (result: SendEmailResult) => Promise<void>;
}

const fail = (
  status: 400 | 403 | 429 | 500 | 503,
  error: string,
  extra: { needsVerification?: boolean } = {}
): SaveOrganizerEmailOutcome => ({ status, body: { error, ...extra } });

const ok = (message: string): SaveOrganizerEmailOutcome => ({
  status: 200,
  body: { success: true, message },
});

export async function saveOrganizerEmail(
  deps: SaveOrganizerEmailDeps,
  input: { raw: unknown; currentEmail: string | null | undefined }
): Promise<SaveOrganizerEmailOutcome> {
  if (!deps.isSameOrigin()) return fail(403, "Please save your email from the event page.");
  if (!(await deps.requireAdmin())) return fail(403, "Unauthorized.");

  const parsed = parseOrganizerEmailInput(input.raw);
  if (!parsed.ok) return fail(400, parsed.error);
  if (sameEmail(parsed.email, input.currentEmail)) return ok(EMAIL_ALREADY_SAVED);

  const bot = deps.assessBot();
  if (bot.verdict === "bot") return fail(400, "Couldn't save the email. Please try again.");

  // Mail on but no bot check configured: refuse rather than send unchecked.
  if (deps.mailConfigured && !deps.turnstileConfigured) {
    return fail(503, "Saving an email isn't available right now.");
  }

  // Limits come before any outside call (siteverify, mail).
  const tooMany = "Too many email changes. Please wait a while and try again.";
  if (!deps.ipRateLimitOk()) return fail(429, tooMany);
  let admitted: boolean;
  try {
    admitted = await deps.reserveEventChange();
  } catch {
    return fail(503, "Couldn't save the email right now. Please try again later.");
  }
  if (!admitted) return fail(429, tooMany);

  if (deps.mailConfigured || bot.verdict === "challenge") {
    if (!(await deps.verifyTurnstile())) {
      const f = turnstileFailure(false);
      return fail(403, f.body.error);
    }
  }

  try {
    await deps.saveEmail(parsed.email);
  } catch {
    return fail(500, "Couldn't save the email. Please try again.");
  }

  // The address is saved from here on; the backup email is best-effort.
  if (!deps.mailConfigured) return ok(EMAIL_SAVED_NOT_SENT);
  // A pre-check, not a reservation: saves racing at the limit can each send
  // once (bounded by the per-event and per-IP limits above). The provider's
  // own quota stays authoritative.
  if (!(await deps.budgetAvailable())) return ok(EMAIL_SAVED_NOT_SENT);

  let result: SendEmailResult;
  try {
    result = await deps.sendLinkEmail(parsed.email);
  } catch {
    return ok(EMAIL_SAVED_NOT_SENT);
  }
  if (!result.skipped) {
    try {
      await deps.trackUsage(result);
    } catch {
      // Usage tracking never changes the outcome.
    }
  }
  return ok(result.success && !result.skipped ? EMAIL_SAVED_AND_SENT : EMAIL_SAVED_NOT_SENT);
}
