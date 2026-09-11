// URL-shortener style short IDs: alphanumeric only, URL-safe with no encoding needed.
//
// - Public event IDs go in the URL path (/events/:id) -> short (10 chars, ~59 bits).
//   Example: /events/K7xQ2mZ9pA instead of /events/550e8400-e29b-41d4-a716-446655440000
// - Secret tokens (admin / edit) stay high-entropy (32 chars, ~190 bits > UUID's 122 bits).
// - Internal row IDs (slots, signups, votes) use 12 chars (~71 bits).
//
// Works in Cloudflare Workers, Node, and browsers via Web Crypto.

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ALPHABET_SIZE = ALPHABET.length;

export function generateShortId(size = 10): string {
  if (size <= 0) throw new Error("generateShortId: size must be > 0");
  const random = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  // Map each random byte to an alphabet char. Modulo bias is negligible
  // for non-security-critical lengths here; secrets use 32 chars (~190 bits)
  // which dwarfs the bias. Rejection sampling would waste entropy on edge.
  for (let i = 0; i < size; i++) {
    id += ALPHABET[random[i] % ALPHABET_SIZE];
  }
  return id;
}

/** Public event ID for URLs: e.g. `K7xQ2mZ9pA` (10 chars). */
export function generatePublicId(): string {
  return generateShortId(10);
}

/** Internal row ID for slots / signups / votes (12 chars). */
export function generateInternalId(): string {
  return generateShortId(12);
}

/** Secret admin / edit token (32 chars, ~190 bits — stronger than a UUID). */
export function generateSecretToken(): string {
  return generateShortId(32);
}

/**
 * Generate a public event ID guaranteed unique in the events table.
 * Pass a callback that returns true when the candidate already exists.
 */
export async function generateUniquePublicId(
  exists: (candidate: string) => Promise<boolean>
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generatePublicId();
    if (!(await exists(candidate))) return candidate;
  }
  // Extremely unlikely fallback: longer ID on repeated collision.
  return generateShortId(16);
}
