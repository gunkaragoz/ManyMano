import { emailFooter } from "./email";
import { escapeHtml } from "./sanitize";

export type PollVoteUpdateKind = "vote" | "update" | "removal";

/** Email to the organizer when a guest votes, changes or removes their vote. */
export function buildPollVoteUpdateEmail(args: {
  kind: PollVoteUpdateKind;
  eventTitle: string;
  participantName: string;
  participantEmail?: string | null;
  /** Option labels the voter answered YES / MAYBE (ignored for removals). */
  yes: string[];
  maybe: string[];
  /** e.g. "Mon, June 1st · 10:00 AM (3 yes, 1 maybe)"; empty when no votes. */
  leadingLine: string;
  eventUrl: string;
  site: Parameters<typeof emailFooter>[0];
}): { subject: string; html: string } {
  const heading =
    args.kind === "vote" ? "New vote" : args.kind === "update" ? "Vote updated" : "Vote removed";
  const action =
    args.kind === "vote"
      ? "voted on"
      : args.kind === "update"
        ? "updated their vote on"
        : "removed their vote from";
  const list = (labels: string[]) => labels.map((l) => escapeHtml(l)).join("<br>");
  const answers =
    args.kind === "removal"
      ? ""
      : args.yes.length === 0 && args.maybe.length === 0
        ? `<p><strong>Available:</strong> none of the options</p>`
        : `${args.yes.length ? `<p><strong>Yes:</strong><br>${list(args.yes)}</p>` : ""}${
            args.maybe.length ? `<p><strong>Maybe:</strong><br>${list(args.maybe)}</p>` : ""
          }`;
  return {
    subject: `${heading}: ${args.participantName} on "${args.eventTitle}"`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="color: #0f172a; margin-top: 0;">${heading}</h2>
        <p><strong>${escapeHtml(args.participantName)}${args.participantEmail ? ` (${escapeHtml(args.participantEmail)})` : ""}</strong> ${action} <strong>${escapeHtml(args.eventTitle)}</strong>.</p>
        ${answers}
        ${args.leadingLine ? `<p><strong>Leading option so far:</strong> ${escapeHtml(args.leadingLine)}</p>` : ""}
        <p><a href="${escapeHtml(args.eventUrl)}" style="color: #2563eb;">Open poll</a></p>
        ${emailFooter(args.site)}
      </div>
    `,
  };
}
