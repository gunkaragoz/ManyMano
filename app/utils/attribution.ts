// Landing-page attribution for the SEO loop (see seo/README.md).
//
// The conversion is "an organizer created an event". To tell which pages earn
// that, the browser remembers the first page of the visit and where the
// visitor came from (sessionStorage, no cookies, no IDs), and the create
// forms post both along. The server only ever stores daily counts per
// (type, channel, landing) — never anything about the person.
//
// Kept dependency-free: this module ships in the client bundle.

export const ATTRIBUTION_STORAGE_KEY = "mm:landing";

export const CHANNELS = ["search", "ai", "social", "referral", "direct"] as const;
export type Channel = (typeof CHANNELS)[number];

// Hostname suffixes. Matching is on the registrable end so "www.google.co.uk"
// and "google.com" both count as search.
const SEARCH_HOSTS = [
  "google.",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "yandex.",
  "baidu.com",
  "ecosia.org",
  "search.brave.com",
  "startpage.com",
  "qwant.com",
  "kagi.com",
];
const AI_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
  "you.com",
  "phind.com",
];
const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "t.co",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "reddit.com",
  "pinterest.com",
  "youtube.com",
  "tiktok.com",
  "nextdoor.com",
  "threads.net",
  "bsky.app",
];

function hostMatches(host: string, needle: string): boolean {
  if (needle.endsWith(".")) {
    // "google." → any google.<tld>, including subdomains like www.google.de
    return host.startsWith(needle) || host.includes(`.${needle}`);
  }
  return host === needle || host.endsWith(`.${needle}`);
}

/** Classify where a visit came from. Own-site and unparseable referrers are "direct". */
export function classifyChannel(referrer: string | null | undefined, siteHost: string): Channel {
  if (!referrer) return "direct";
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "direct";
  }
  const own = siteHost.toLowerCase().replace(/^www\./, "");
  if (!host || host === own) return "direct";
  // AI before search: gemini.google.com must not count as Google search.
  if (AI_HOSTS.some((h) => hostMatches(host, h))) return "ai";
  if (SEARCH_HOSTS.some((h) => hostMatches(host, h))) return "search";
  if (SOCIAL_HOSTS.some((h) => hostMatches(host, h))) return "social";
  return "referral";
}

const FIXED_LANDINGS = new Set(["/", "/create", "/create/signup", "/create/poll", "/templates", "/pulse"]);
const TEMPLATE_LANDING = /^\/(signup-sheet|meeting-poll)\/[a-z0-9-]{1,80}$/;

/**
 * Reduce a path to a small, fixed vocabulary so counters can't be spammed
 * with arbitrary keys. Event pages collapse to "/events" (they are unlisted,
 * and the id is not ours to count). Anything else is "other".
 * Template slugs are shape-checked here; the server also checks they exist.
 */
export function normalizeLandingPath(raw: string | null | undefined): string {
  if (!raw) return "other";
  let path = raw;
  try {
    path = new URL(raw, "https://x.invalid").pathname;
  } catch {
    return "other";
  }
  path = path.toLowerCase();
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (FIXED_LANDINGS.has(path)) return path;
  if (TEMPLATE_LANDING.test(path)) return path;
  if (path === "/events" || path.startsWith("/events/")) return "/events";
  return "other";
}

export function normalizeChannel(raw: unknown): Channel {
  return typeof raw === "string" && (CHANNELS as readonly string[]).includes(raw) ? (raw as Channel) : "direct";
}

export type StoredAttribution = { landing: string; channel: Channel };

/**
 * Inline <head> snippet: store the raw first path + referrer of this tab's
 * visit before hydration, so a quick click on a slow phone still credits the
 * page the visitor actually landed on. Static string — nothing interpolated.
 * Classification happens later in readAttribution().
 */
export const LANDING_CAPTURE_SCRIPT = `try{var s=sessionStorage;if(!s.getItem("${ATTRIBUTION_STORAGE_KEY}"))s.setItem("${ATTRIBUTION_STORAGE_KEY}",JSON.stringify({path:location.pathname,ref:document.referrer}))}catch(e){}`;

/** Read the visit's attribution from sessionStorage (null when unavailable). */
export function readAttribution(): StoredAttribution | null {
  try {
    const raw = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: string; ref?: string };
    return {
      landing: normalizeLandingPath(parsed.path),
      channel: classifyChannel(parsed.ref, window.location.hostname),
    };
  } catch {
    return null;
  }
}

/** Fallback for the inline snippet (e.g. storage raced): same raw format. */
export function rememberLanding(pathname: string, referrer: string): void {
  try {
    if (window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY)) return;
    window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify({ path: pathname, ref: referrer }));
  } catch {
    // Private mode / blocked storage: the conversion is counted as unattributed.
  }
}
