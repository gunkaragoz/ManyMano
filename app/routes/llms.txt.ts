import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import {
  DEFAULT_SITE_URL,
  SITE_NAME,
  SITE_TAGLINE,
  absoluteUrl,
} from "~/utils/seo";

export async function loader({ request }: LoaderFunctionArgs) {
  void request;

  const link = (label: string, path: string) =>
    `- [${label}](${absoluteUrl(path, DEFAULT_SITE_URL)})`;

  const body = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_TAGLINE}`,
    "",
    `${SITE_NAME} is an open-source, free-forever web tool for coordinating people. Organizers create sign-up sheets (volunteer shifts, potluck lists, task sign-ups) and meeting time polls (consensus grids), then share a public link. Participants respond with just a name — no account required. Events are unlisted and excluded from search engines.`,
    "",
    "## Features",
    "",
    "- Sign-up sheets with per-slot capacity limits, overbooking protection, custom attendee notes, and CSV roster export.",
    "- Meeting polls with a consensus matrix (Yes / If need be / No), automatic top-slot highlighting, and time-zone aware display.",
    "- Instant calendar invites via one-click Google Calendar links and RFC 5545 .ics downloads (Apple Calendar, Outlook).",
    "- No accounts or passwords; events are created and shared in seconds.",
    "- Organizer admin mode via a secret link; participants get cancel links when they leave an email.",
    "",
    "## Key pages",
    "",
    link("Home", "/"),
    link("Create a sign-up sheet", "/create/signup"),
    link("Create a meeting poll", "/create/poll"),
    link("How it works", "/create"),
    "- [GitHub](https://github.com/manymano/manymano)",
    "",
  ].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
