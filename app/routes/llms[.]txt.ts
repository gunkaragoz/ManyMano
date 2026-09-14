import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { absoluteUrl } from "~/utils/seo";
import { getSiteConfig } from "~/utils/site";

export async function loader({ request, context }: LoaderFunctionArgs) {
  void request;
  const site = getSiteConfig(context.cloudflare.env);
  const siteUrl = site.siteUrl;
  const siteName = site.siteName;
  const siteTagline = site.siteTagline;
  const githubRepoUrl = site.githubRepoUrl;

  const link = (label: string, path: string) =>
    `- [${label}](${absoluteUrl(path, siteUrl)})`;

  const links = [
    link("Home", "/"),
    link("Create a sign-up sheet", "/create/signup"),
    link("Create a meeting poll", "/create/poll"),
    link("How it works", "/create"),
    ...(githubRepoUrl ? [`- [GitHub](${githubRepoUrl})`] : []),
    "",
  ];

  const body = [
    `# ${siteName}`,
    "",
    `> ${siteTagline}`,
    "",
    `${siteName} is an open-source, free-forever web tool for coordinating people. Organizers create sign-up sheets (volunteer shifts, potluck lists, task sign-ups) and meeting time polls (consensus grids), then share a public link. Participants respond with just a name — no account required. Events are unlisted and excluded from search engines.`,
    "",
    "## Features",
    "",
    "- Sign-up sheets with per-slot capacity limits, overbooking protection, custom attendee notes, and CSV roster export.",
    "- Meeting polls with a consensus matrix (Yes / Maybe / No), automatic top-slot highlighting, and time-zone aware display.",
    "- Instant calendar invites via one-click Google Calendar links and RFC 5545 .ics downloads (Apple Calendar, Outlook).",
    "- No accounts or passwords; events are created and shared in seconds.",
    "- Organizer admin mode via a secret link; participants get cancel links when they leave an email.",
    "",
    "## Key pages",
    "",
    ...links,
  ].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
