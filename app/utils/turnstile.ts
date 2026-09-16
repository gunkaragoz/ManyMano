// Server-side Cloudflare Turnstile verification (canonical siteverify).
// Browser → our Remix action → challenges.cloudflare.com/siteverify.
// Never call siteverify from the browser.

export interface TurnstileEnv {
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_HOSTNAMES?: string;
}

export type TurnstileAction = "create-signup" | "create-poll" | "event-signup" | "poll-vote" | "resend-admin";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(opts: {
  token: string | null | undefined;
  expectedAction: TurnstileAction;
  env: TurnstileEnv;
  remoteIp?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const secret = opts.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    // Dev passthrough: local environments without a secret skip verification.
    // Production MUST set TURNSTILE_SECRET_KEY (see dashboard steps) —
    // without it there is no bot protection.
    console.warn("[Turnstile] TURNSTILE_SECRET_KEY not configured — skipping verification (dev passthrough).");
    return { ok: true, reason: "unconfigured" };
  }

  const token = (opts.token ?? "").trim();
  if (!token || token.length > 2048) {
    return { ok: false, reason: "missing-token" };
  }

  const expectedHostnames = new Set(
    (opts.env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  );
  if (expectedHostnames.size === 0) {
    // Fail closed: a configured secret with no hostname allowlist is a
    // misconfiguration — never let it silently pass.
    console.error("[Turnstile] TURNSTILE_HOSTNAMES not configured — failing closed.");
    return { ok: false, reason: "hostnames-unconfigured" };
  }

  let result: {
    success?: boolean;
    action?: string;
    hostname?: string;
  };
  try {
    const params = new URLSearchParams({ secret, response: token });
    if (opts.remoteIp) params.set("remoteip", opts.remoteIp);
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: params,
    });
    if (!res.ok) return { ok: false, reason: `siteverify-${res.status}` };
    result = (await res.json()) as typeof result;
  } catch {
    // Network error, non-2xx, or non-JSON body from siteverify. Fail closed.
    return { ok: false, reason: "siteverify-error" };
  }

  if (
    !result.success ||
    result.action !== opts.expectedAction ||
    !result.hostname ||
    !expectedHostnames.has(result.hostname.toLowerCase())
  ) {
    return { ok: false, reason: "verification-failed" };
  }
  return { ok: true };
}

export function turnstileFailure(needsVerification = false) {
  return {
    body: {
      error: needsVerification
        ? "One quick human check is needed — please complete the challenge and try again."
        : "Bot verification failed. Please complete the challenge and try again.",
      needsVerification: needsVerification as boolean,
    },
    status: 403 as const,
  };
}

/** True when the client actually submitted a (possibly stale) token. */
export function hasTurnstileToken(formData: FormData): boolean {
  const token = ((formData.get("cf-turnstile-response") as string | null) ?? "").trim();
  return token.length > 0;
}
