// Copy for /signupgenius-alternative. Brand-templated (never hardcode the site
// name). Every SignUpGenius claim must be backed by one of SOURCES and
// re-checked when LAST_CHECKED is bumped; every claim about us must match the
// product (see seo/BRIEF.md: "Never claim features we don't have").

import type { FaqItem } from "~/utils/seo";
import { getTemplate, templatePath } from "~/utils/templates";

export const SIGNUPGENIUS_ALTERNATIVE_PATH = "/signupgenius-alternative";
export const COMPETITOR = "SignUpGenius";

/** When the SignUpGenius column and FAQ were last checked against SOURCES. */
export const LAST_CHECKED = "November 5, 2026";

export const SOURCES: Array<{ label: string; url: string }> = [
  { label: "pricing page", url: "https://www.signupgenius.com/pricing" },
  { label: "plan guide", url: "https://www.signupgenius.com/resources/how-to-choose-plan" },
  {
    label: "custom questions",
    url: "https://support.signupgenius.com/hc/en-us/articles/29572678587671-Add-Custom-Questions",
  },
  {
    label: "waitlists",
    url: "https://support.signupgenius.com/hc/en-us/articles/29838121963031-How-to-Add-a-Waitlist-to-Your-Sign-Up",
  },
  {
    label: "calendar subscriptions",
    url: "https://support.signupgenius.com/hc/en-us/articles/29572712350871-Manage-Calendar-Subscriptions",
  },
];

export type ComparisonRow = { feature: string; ours: string; theirs: string };

export function comparisonRows(): ComparisonRow[] {
  return [
    { feature: "Free sign-up sheets", ours: "Yes", theirs: "Yes" },
    { feature: "Ads on sign-up pages", ours: "Ad-free", theirs: "Free pages show ads; paid plans remove them" },
    { feature: "Organizer access", ours: "Private organizer link—no admin account needed", theirs: "Organizer account" },
    { feature: "Participant access", ours: "No account needed", theirs: "Generally no account needed" },
    {
      feature: "Shifts and spot limits",
      ours: "Set dates, shifts, tasks, and available spots",
      theirs: "Create slots with available quantities",
    },
    {
      feature: "Ready-made starting points",
      ours: "Editable templates for school, volunteer, sports, and community events",
      theirs: "Sign-up formats and design themes",
    },
    { feature: "Email reminders", ours: "Automatic email reminders", theirs: "Automatic reminders" },
    {
      feature: "Calendar options",
      ours: "Add to Google Calendar or download a calendar invite",
      theirs: "Individual calendar options; full sign-up calendar feeds on paid plans",
    },
    {
      feature: "Participant details",
      ours: "Name, optional email, and a note",
      theirs: "Participant details, with custom questions on paid plans",
    },
    { feature: "Export", ours: "Organizer CSV export", theirs: "Reporting and export tools" },
    {
      feature: "Multiple administrators",
      ours: "Share the organizer link with co-organizers (one shared link, no separate logins)",
      theirs: "Separate administrator access on paid plans",
    },
    { feature: "Waitlists", ours: "No built-in waitlist", theirs: "Available on paid plans" },
    { feature: "Collecting payments", ours: "No built-in payments", theirs: "Available with transaction fees" },
    { feature: "Open source", ours: "Yes", theirs: "No" },
  ];
}

export function signupGeniusFaq(siteName: string): FaqItem[] {
  if (!siteName) throw new Error("[config] signupGeniusFaq requires siteName (SITE_NAME).");
  return [
    {
      question: `Can I move an existing ${COMPETITOR} sheet to ${siteName}?`,
      answer: `There's no automatic import, so existing participants and responses won't transfer. Recreate the dates, shifts, and tasks in ${siteName}, or start from a template, then share your new link when you're ready for people to sign up.`,
    },
    {
      question: `Can I reuse a ${siteName} sheet?`,
      answer: "Yes. Choose Make a copy on an existing event to reuse its structure with new dates and an empty sign-up list.",
    },
    {
      question: "Who can see my sheet?",
      answer:
        "Anyone with the shared link can view the sheet, including participant names and notes. Email addresses are visible only to the organizer. Keep your organizer link private, because it lets anyone who has it manage the event.",
    },
  ];
}

const FEATURED_TEMPLATES: Array<{ slug: string; label: string; blurb: string }> = [
  { slug: "book-fair", label: "Book fair volunteers", blurb: "Setup, cashier, and floor-helper shifts." },
  { slug: "parent-teacher-conferences", label: "Parent–teacher conferences", blurb: "15-minute appointment slots, one family each." },
  { slug: "classroom-party", label: "Classroom parties", blurb: "Helpers, supplies, snacks, and drinks." },
  { slug: "concession-stand", label: "Concession stands", blurb: "Volunteer shifts for game day." },
  { slug: "snack-schedule", label: "Team snacks", blurb: "A shared snack schedule for the season." },
  { slug: "potluck", label: "Potlucks", blurb: "Dishes and supplies guests can claim." },
];

/** Featured templates with resolved paths. Throws if a slug is renamed. */
export function featuredTemplates() {
  return FEATURED_TEMPLATES.map((f) => {
    const t = getTemplate(f.slug);
    if (!t) throw new Error(`[templates] featured template "${f.slug}" no longer exists`);
    return { ...f, icon: t.icon, path: templatePath(t) };
  });
}
