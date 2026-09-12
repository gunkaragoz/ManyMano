function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isHex64(s: string): boolean {
  return s.length === 64 && /^[0-9a-f]{64}$/i.test(s);
}

/** Hash a newly generated secret for storage. Legacy rows may be plaintext. */
export async function hashSecretForStorage(plaintext: string): Promise<string> {
  return sha256Hex(plaintext);
}

/**
 * Compare a presented token against a stored value that may be
 * a SHA-256 hex hash (new) or plaintext (legacy pre-hash rows).
 */
export async function secretMatches(
  presented: string | null | undefined,
  stored: string | null | undefined
): Promise<boolean> {
  if (!presented || !stored) return false;
  if (isHex64(stored)) {
    const hashed = await sha256Hex(presented);
    return timingSafeEqualString(hashed, stored.toLowerCase());
  }
  return timingSafeEqualString(presented, stored);
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqualString(a, b);
}

function cookieName(eventId: string): string {
  return `mm_admin_${eventId}`;
}

/** Prefer HttpOnly cookie, fall back to ?admin= query param (legacy/bookmark). */
export function getPresentedAdminToken(request: Request, eventId: string): string | null {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const idx = p.indexOf("=");
        if (idx === -1) return [p, ""];
        return [p.slice(0, idx).trim(), decodeURIComponent(p.slice(idx + 1).trim())];
      })
  );
  const fromCookie = cookies[cookieName(eventId)];
  if (fromCookie) return fromCookie;
  const url = new URL(request.url);
  return url.searchParams.get("admin");
}

export function buildAdminCookie(eventId: string, token: string): string {
  // Scoped to /events (not /events/<id>) so the cookie is also sent on
  // Remix single-fetch `.data` requests (e.g. `/events/<id>.data`), whose
  // path would otherwise not match per RFC 6265 (boundary must be `/`,
  // not `.`). The cookie NAME already scopes it to one event, and the
  // server only accepts it for that eventId, so nothing leaks across events.
  // Secure is ignored on http://localhost by browsers but harmless to send.
  return `${cookieName(eventId)}=${encodeURIComponent(
    token
  )}; Path=/events; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

export function buildExpiredAdminCookie(eventId: string): string {
  return `${cookieName(eventId)}=; Path=/events; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Best-effort in-memory rate limit for admin guesses (per worker isolate).
// Bounded: evicts expired entries and caps size to avoid memory-exhaustion
// abuse via distinct keys. For production-grade limiting across isolates,
// add Cloudflare Rate Limiting Rules in front of /events/* instead.
const attempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX_KEYS = 5000;

export function checkAdminRateLimit(key: string, limit = 20, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    // Opportunistic cleanup on insert path (amortized, no timer needed).
    if (attempts.size >= RATE_LIMIT_MAX_KEYS) {
      for (const [k, v] of attempts) {
        if (now > v.resetAt) attempts.delete(k);
        if (attempts.size < RATE_LIMIT_MAX_KEYS * 0.8) break;
      }
      // Still full (active flood): evict oldest inserted key (Map order).
      if (attempts.size >= RATE_LIMIT_MAX_KEYS) {
        const oldest = attempts.keys().next();
        if (!oldest.done) attempts.delete(oldest.value);
      }
    }
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}
