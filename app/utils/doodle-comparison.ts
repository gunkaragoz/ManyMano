// Copy for /doodle-alternative. Brand-templated (never hardcode the site
// name). Every Doodle claim must be backed by one of SOURCES and re-checked
// when LAST_CHECKED is bumped; every claim about us must match the product
// (see seo/BRIEF.md: "Never claim features we don't have").

import type { FaqItem } from "~/utils/seo";
import { getTemplate, templatePath } from "~/utils/templates";

export const DOODLE_ALTERNATIVE_PATH = "/doodle-alternative";
export const COMPETITOR = "Doodle";

/** When the Doodle column and FAQ were last checked against SOURCES. */
export const LAST_CHECKED = "November 5, 2026";

export const SOURCES: Array<{ label: string; url: string }> = [
  { label: "pricing page", url: "https://doodle.com/en/premium/" },
  {
    label: "free vs. paid comparison",
    url: "https://help.doodle.com/en/articles/10448913-doodle-free-and-doodle-professional-differences-at-a-glance",
  },
  {
    label: "account requirement",
    url: "https://help.doodle.com/en/articles/12086821-how-can-i-create-a-group-poll-without-an-account",
  },
  {
    label: "if-need-be answers",
    url: "https://help.doodle.com/en/articles/9457343-how-does-the-if-need-be-group-poll-response-work",
  },
];

export type ComparisonRow = { feature: string; ours: string; theirs: string };

export function comparisonRows(): ComparisonRow[] {
  return [
    {
      feature: "Free group polls",
      ours: "Yes, as many as you need",
      theirs: "One group poll on the free plan; unlimited on paid plans",
    },
    {
      feature: "Ads",
      ours: "Ad-free",
      theirs: "Free plan shows ads to organizers and participants; paid plans remove them",
    },
    {
      feature: "Organizer access",
      ours: "No account—enter your email and get a private organizer link",
      theirs: "Free or paid account required to create a poll",
    },
    { feature: "Participant access", ours: "No account needed", theirs: "No account needed" },
    { feature: "Answer choices", ours: "Yes, Maybe, or No", theirs: "Yes or “if need be”" },
    {
      feature: "Deadlines and reminders",
      ours: "No voting deadline; voters who leave an email get a reminder before the chosen time",
      theirs: "Deadlines and automated reminders on paid plans",
    },
    {
      feature: "Hiding participants",
      ours: "No—anyone with the link sees names and votes (emails stay private)",
      theirs: "Hide participant details on paid plans",
    },
    {
      feature: "Calendar",
      ours: "Add the chosen time to Google Calendar or download a calendar invite",
      theirs: "Connect your calendar to see conflicts and sync meetings",
    },
    {
      feature: "Video meeting links",
      ours: "No integration—paste any meeting link into the location",
      theirs: "Zoom and Google Meet; Microsoft Teams and Webex on paid plans",
    },
    {
      feature: "Sign-up sheets",
      ours: "Free and unlimited",
      theirs: "One on the free plan; unlimited on paid plans",
    },
    { feature: "Booking pages and 1:1 scheduling", ours: "Not available", theirs: "Yes (one of each on the free plan)" },
    { feature: "Open source", ours: "Yes", theirs: "No" },
  ];
}

export function doodleFaq(siteName: string): FaqItem[] {
  if (!siteName) throw new Error("[config] doodleFaq requires siteName (SITE_NAME).");
  return [
    {
      question: `Can I move an existing ${COMPETITOR} poll to ${siteName}?`,
      answer: `There's no automatic import, so existing votes won't transfer. Add the same dates and times to a new ${siteName} poll, or start from a template, then share the new link with your group.`,
    },
    {
      question: "What do participants need to do?",
      answer:
        "Open the link, enter a name, and mark each time Yes, Maybe, or No. An email is optional; people who add one hear when the time is locked in and get a reminder before the meeting.",
    },
    {
      question: "Who can see my poll?",
      answer:
        "Anyone with the shared link can see the options and everyone's names and votes. Email addresses are visible only to the organizer. Keep your organizer link private, because it lets anyone who has it manage the poll.",
    },
  ];
}

const FEATURED_TEMPLATES: Array<{ slug: string; label: string; blurb: string }> = [
  { slug: "team-meeting", label: "Team meetings", blurb: "Morning and afternoon options across next week." },
  { slug: "pta-meeting", label: "PTA meetings", blurb: "Weeknight evenings over the next two weeks." },
  { slug: "committee-meeting", label: "Committee meetings", blurb: "Six weeknight options for volunteers." },
  { slug: "book-club", label: "Book clubs", blurb: "Weeknight evenings for your next discussion." },
  { slug: "family-reunion", label: "Family reunions", blurb: "Weekend afternoons a few weeks out." },
  { slug: "band-rehearsal", label: "Rehearsals", blurb: "Evening slots this week, Saturday included." },
];

/** Featured templates with resolved paths. Throws if a slug is renamed. */
export function featuredTemplates() {
  return FEATURED_TEMPLATES.map((f) => {
    const t = getTemplate(f.slug);
    if (!t) throw new Error(`[templates] featured template "${f.slug}" no longer exists`);
    return { ...f, icon: t.icon, path: templatePath(t) };
  });
}
