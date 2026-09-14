// Frictionless bot protection for guest writes (event signup / poll vote).
//
// Strategy (free-tier friendly):
// - Honeypot + time-trap catch dumb bots with zero UX cost.
// - Per-isolate in-memory rate limit flags floods for a Turnstile challenge.
// - Turnstile is then *on-demand*: low-risk guests submit with no widget at
//   all; only suspicious requests must solve it.
// - Creators (create-signup / create-poll) keep mandatory Turnstile for now —
//   one organizer tolerates friction, dozens of guests must not.
//
// Dashboard (free) to pair with this:
// - Security → Bots → Bot Fight Mode: ON
// - Security → WAF → Rate limiting rules: POST to /events/* + /create/*,
//   e.g. 30 req / 10 min per IP (tune to traffic).

export const HONEYPOT_FIELD = "company_website";
export const FORM_START_FIELD = "formStartedAt";

/** Minimum human time from form render → submit. Faster = bot-like. */
export const MIN_HUMAN_MS = 2500;

/** Guest write rate limit: 30 submits / 10 min per IP+event (per isolate). */
const GUEST_LIMIT = 30;
const GUEST_WINDOW_MS = 10 * 60 * 1000;
const MAX_KEYS = 5000;

const guestAttempts = new Map<string, { count: number; resetAt: number }>();

function guestRateLimitOk(key: string): boolean {
  const now = Date.now();
  const entry = guestAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    if (guestAttempts.size >= MAX_KEYS) {
      for (const [k, v] of guestAttempts) {
        if (now > v.resetAt) guestAttempts.delete(k);
        if (guestAttempts.size < MAX_KEYS * 0.8) break;
      }
      if (guestAttempts.size >= MAX_KEYS) {
        const oldest = guestAttempts.keys().next();
        if (!oldest.done) guestAttempts.delete(oldest.value);
      }
    }
    guestAttempts.set(key, { count: 1, resetAt: now + GUEST_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= GUEST_LIMIT;
}

export type GuestAssessment =
  | { verdict: "allow" }
  | { verdict: "bot" }
  | { verdict: "challenge"; reason: "too-fast" | "rate-limited" };

/**
 * Assess a guest write without any Turnstile token. Purely server-side
 * signals — safe to run before DB work.
 */
export function assessGuestRequest(
  formData: FormData,
  opts: { ip: string; eventId: string }
): GuestAssessment {
  // 1. Honeypot: real humans never see this field (offscreen + aria-hidden).
  // Bots that autofill every text input self-identify here.
  const honeypot = (formData.get(HONEYPOT_FIELD) as string | null) ?? "";
  if (honeypot.trim().length > 0) {
    return { verdict: "bot" };
  }

  // 2. Rate limit per IP+event. Floods get challenged, not blocked outright —
  // a shared office / NAT IP shouldn't hard-fail, just prove humanity once.
  if (!guestRateLimitOk(`guest:${opts.ip}:${opts.eventId}`)) {
    return { verdict: "challenge", reason: "rate-limited" };
  }

  // 3. Time trap: submitted implausibly fast after render. Missing timestamp
  // (old cached page, no-JS, tests) is allowed — don't punish legit clients.
  const startedRaw = (formData.get(FORM_START_FIELD) as string | null) ?? "";
  if (startedRaw) {
    const started = Number(startedRaw);
    if (Number.isFinite(started) && started > 0) {
      if (Date.now() - started < MIN_HUMAN_MS) {
        return { verdict: "challenge", reason: "too-fast" };
      }
    }
  }

  return { verdict: "allow" };
}

/** Shape returned when a challenge is required so the UI can mount Turnstile. */
export function needsVerification(reason: GuestAssessment & { verdict: "challenge" }) {
  return {
    body: {
      error:
        reason.reason === "rate-limited"
          ? "Lots of activity from your network — one quick human check, then you're through."
          : "That was fast — one quick human check, then you're through.",
      needsVerification: true as const,
    },
    status: 403 as const,
  };
}
