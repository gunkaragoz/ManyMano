// Central SEO / GEO constants + helpers.
// Single source of truth so copy, JSON-LD, sitemap, robots and llms.txt never drift.

export const DEFAULT_SITE_URL = "https://manymano.com";

export const SITE_NAME = "ManyMano";

export const SITE_TAGLINE =
  "Free sign-up sheets and meeting polls. No accounts, no ads — create and share in seconds.";

export const OG_IMAGE_PATH = "/og-cover.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Resolve the canonical site origin: env override → request origin → default. */
export function getSiteUrl(request?: Request): string {
  // Cloudflare Pages / Workers env is not visible here at module scope,
  // so allow an explicit override via request origin, else default.
  if (request) {
    try {
      const origin = new URL(request.url).origin;
      // Prefer the production domain; accept preview origins for previews.
      if (origin && origin.startsWith("http")) {
        // If we're on the production domain or localhost/preview, use it.
        // Canonical tags on preview deploys still point at production via meta overrides.
        return origin.replace(/\/$/, "");
      }
    } catch {
      // fall through to default
    }
  }
  const envUrl =
    typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined>)?.SITE_URL
      : undefined;
  if (envUrl) return envUrl.replace(/\/$/, "");
  return DEFAULT_SITE_URL;
}

export function absoluteUrl(path: string, siteUrl: string = DEFAULT_SITE_URL): string {
  const base = siteUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export function organizationJsonLd(siteUrl: string = DEFAULT_SITE_URL) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: siteUrl,
    logo: absoluteUrl("/favicon.svg", siteUrl),
    sameAs: ["https://github.com/manymano/manymano"],
  };
}

export function websiteJsonLd(siteUrl: string = DEFAULT_SITE_URL) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: siteUrl,
    description: SITE_TAGLINE,
    inLanguage: "en",
  };
}

export function softwareAppJsonLd(siteUrl: string = DEFAULT_SITE_URL) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: siteUrl,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "ManyMano is a free, ad-free tool for sign-up sheets and meeting time polls. No accounts — create and share in seconds with CSV roster export and .ics calendar invites.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    isAccessibleForFree: true,
  };
}

export type FaqItem = { question: string; answer: string };

export const HOME_FAQ: FaqItem[] = [
  {
    question: "Is ManyMano really free?",
    answer:
      "Yes. ManyMano is free forever with no paywalls or feature limits and is open source.",
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
    answer:
      "Propose candidate time slots, attendees vote Yes, If need be, or No, and ManyMano highlights the top consensus slot. The organizer can then lock the winning time.",
  },
];

export function faqPageJsonLd(faqs: FaqItem[] = HOME_FAQ) {
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
  siteUrl: string = DEFAULT_SITE_URL
) {
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
