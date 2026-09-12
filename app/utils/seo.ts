// Central SEO / GEO helpers.
// Single source of truth so copy, JSON-LD, sitemap, robots and llms.txt never drift.
//
// Brand + domain values are NOT hardcoded here. Every helper takes an
// explicit `siteUrl` / `siteName` / `githubRepoUrl` argument resolved from
// `getSiteConfig(env)` — missing required env throws (fail-fast, no fallback).
// `githubRepoUrl` is optional: when omitted the Organization `sameAs` is left out.

import type { PublicSiteConfig } from "~/utils/site";

export const OG_IMAGE_PATH = "/og-cover.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Resolve the canonical site origin from the request (preview-safe). No fallback. */
export function getSiteUrl(request: Request): string {
  const origin = new URL(request.url).origin;
  if (!origin || !origin.startsWith("http")) {
    throw new Error("[config] Unable to resolve site origin from request.");
  }
  return origin.replace(/\/$/, "");
}

export function absoluteUrl(path: string, siteUrl: string): string {
  if (!siteUrl) throw new Error("[config] absoluteUrl requires siteUrl (SITE_URL).");
  const base = siteUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export function organizationJsonLd(siteUrl: string, siteName: string, githubRepoUrl?: string) {
  if (!siteName) throw new Error("[config] organizationJsonLd requires siteName (SITE_NAME).");
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteName,
    url: siteUrl,
    logo: absoluteUrl("/favicon.svg", siteUrl),
    ...(githubRepoUrl ? { sameAs: [githubRepoUrl] } : {}),
  };
}

export function websiteJsonLd(siteUrl: string, siteName: string, siteTagline: string) {
  if (!siteName) throw new Error("[config] websiteJsonLd requires siteName (SITE_NAME).");
  if (!siteTagline) throw new Error("[config] websiteJsonLd requires siteTagline (SITE_TAGLINE).");
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: siteUrl,
    description: siteTagline,
    inLanguage: "en",
  };
}

export function softwareAppJsonLd(siteUrl: string, siteName: string, siteDescription: string) {
  if (!siteName) throw new Error("[config] softwareAppJsonLd requires siteName (SITE_NAME).");
  if (!siteDescription) throw new Error("[config] softwareAppJsonLd requires siteDescription (SITE_DESCRIPTION).");
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteName,
    url: siteUrl,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: siteDescription,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    isAccessibleForFree: true,
  };
}

export type FaqItem = { question: string; answer: string };

/** Build home FAQ copy for the configured brand. No hardcoded fallback. */
export function getHomeFaq(siteName: string): FaqItem[] {
  if (!siteName) throw new Error("[config] getHomeFaq requires siteName (SITE_NAME).");
  return [
    {
      question: `Is ${siteName} really free?`,
      answer: `Yes. ${siteName} is free forever with no paywalls or feature limits and is open source.`,
    },
    {
      question: "Do participants need an account?",
      answer:
        "No. Participants sign up or vote with just a name and optional email. Organizers also create events without registration.",
    },
    {
      question: "How do I share my event?",
      answer:
        "Every event gets a public link to share with attendees and a separate secret admin link to manage responses, export CSV, and delete the event.",
    },
    {
      question: "How do calendar invites work?",
      answer:
        "Attendees can add events to Google Calendar in one click or download a standard .ics file for Apple Calendar and Outlook. No email is required.",
    },
    {
      question: "Are my events private?",
      answer:
        "Yes. Events are unlisted — only people with the link can view them. Event pages are excluded from search engines, and organizer emails are never shown publicly.",
    },
    {
      question: "How does the meeting poll work?",
      answer: `Propose candidate time slots, attendees vote Yes, If need be, or No, and ${siteName} highlights the top consensus slot. The organizer can then lock the winning time.`,
    },
  ];
}

export function faqPageJsonLd(faqs: FaqItem[]) {
  if (!faqs) throw new Error("[config] faqPageJsonLd requires faqs (see getHomeFaq).");
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

export function breadcrumbJsonLd(
  items: Array<{ name: string; path: string }>,
  siteUrl: string
) {
  if (!siteUrl) throw new Error("[config] breadcrumbJsonLd requires siteUrl (SITE_URL).");
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path, siteUrl),
    })),
  };
}

// ---------------------------------------------------------------------------
// Per-page meta helpers (Remix v2 `meta` merging).
//
// Remix renders ONLY the deepest route's `meta` export — it does NOT merge
// parent + child automatically. So every child route that exports `meta`
// must explicitly re-include the parent descriptors it wants to keep.
// These helpers make that override-and-keep-rest pattern trivial and keep
// title / description / canonical / og:url in sync across routes.
// ---------------------------------------------------------------------------

export type GenericMetaDescriptor = Record<string, unknown>;

function descriptorKey(d: GenericMetaDescriptor): string {
  if ("title" in d) return "title";
  if ("charSet" in d || "charset" in d) return "charset";
  if (d.tagName === "link" && typeof d.rel === "string") return `link:${d.rel}`;
  if (typeof d.name === "string") return `name:${d.name}`;
  if (typeof d.property === "string") return `property:${d.property}`;
  if ("script:ld+json" in d) {
    // Each distinct JSON-LD block gets its own key so parent blocks
    // (Organization, WebSite, ...) are kept while the child adds its own.
    try {
      return `script:${JSON.stringify(d["script:ld+json"])}`;
    } catch {
      return `script:${Math.random()}`;
    }
  }
  try {
    return JSON.stringify(d);
  } catch {
    return String(Math.random());
  }
}

/**
 * Keep everything from parent routes except descriptors the child overrides
 * (same title / same meta name / same og property / same link rel).
 */
export function mergeParentMeta(
  matches: Array<{ meta?: GenericMetaDescriptor[] }>,
  overrides: GenericMetaDescriptor[]
): GenericMetaDescriptor[] {
  const overrideKeys = new Set(overrides.map(descriptorKey));
  const parentMeta = matches.flatMap((m) => m.meta ?? []).filter(
    (d) => !overrideKeys.has(descriptorKey(d))
  );
  return [...parentMeta, ...overrides];
}

export type PageMetaOptions = {
  title: string;
  description: string;
  path: string;
  robots?: string;
  siteUrl: string;
};

/** Build the title/description/canonical/OG/Twitter overrides for a page. */
export function pageMetaOverrides({
  title,
  description,
  path,
  robots,
  siteUrl,
}: PageMetaOptions): GenericMetaDescriptor[] {
  if (!siteUrl) throw new Error("[config] pageMetaOverrides requires siteUrl (SITE_URL).");
  const canonical = absoluteUrl(path, siteUrl);
  const descriptors: GenericMetaDescriptor[] = [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: canonical },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
  if (robots) {
    descriptors.push({ name: "robots", content: robots });
  }
  return descriptors;
}

/** Truncate to `max` chars on a word boundary, with ellipsis. */
export function truncate(str: string, max: number): string {
  const s = (str || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const sliced = s.slice(0, max - 1);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
}

export type PageMetaTemplate = { title: string; description: string; path: string };

/** Page titles/descriptions templated on the configured brand. No hardcoded fallback. */
export function getPageMeta(siteName: string): Record<"createChooser" | "createSignup" | "createPoll", PageMetaTemplate> {
  if (!siteName) throw new Error("[config] getPageMeta requires siteName (SITE_NAME).");
  return {
    createChooser: {
      title: `Create Event — Sign-Up Sheet or Meeting Poll | ${siteName}`,
      description:
        "Create a free sign-up sheet or meeting poll in seconds. No accounts, no ads — just share the link.",
      path: "/create",
    },
    createSignup: {
      title: `Create a Free Sign-Up Sheet — No Account Needed | ${siteName}`,
      description:
        "Free sign-up sheets with shifts, slot limits and CSV export. No accounts, no ads — create and share in seconds.",
      path: "/create/signup",
    },
    createPoll: {
      title: `Create a Free Meeting Poll — Find a Time Fast | ${siteName}`,
      description:
        "Free meeting polls with Yes / If need be / No voting and calendar sync. No accounts, no ads — create and share in seconds.",
      path: "/create/poll",
    },
  };
}

/** Read the public site config that the root loader injects (fail-fast). */
export function rootSiteFromMatches(
  matches: Array<{ id: string; data?: unknown }>
): PublicSiteConfig {
  const root = matches.find((m) => m.id === "root")?.data as
    | { site?: PublicSiteConfig }
    | undefined;
  if (!root?.site?.siteUrl || !root?.site?.siteName) {
    throw new Error("[config] Root loader must provide `site` (SITE_URL/SITE_NAME). Ensure root loader calls getSiteConfig(env).");
  }
  return root.site;
}
