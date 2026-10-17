import { emailFooter } from "./email";
import { escapeHtml } from "./sanitize";

export function buildSignupUpdateEmail(args: {
  kind: "signup" | "cancellation";
  eventTitle: string;
  participantName: string;
  taskLabel: string;
  taskTitle: string;
  shiftName?: string | null;
  whenLine: string;
  location?: string | null;
  comment?: string | null;
  eventUrl: string;
  site: Parameters<typeof emailFooter>[0];
}): { subject: string; html: string } {
  const signedUp = args.kind === "signup";
  const heading = signedUp ? "New sign-up" : "Sign-up cancelled";
  const action = signedUp ? "signed up for" : "cancelled their sign-up for";
  return {
    subject: `${heading}: "${args.taskLabel}" for ${args.eventTitle}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="color: #0f172a; margin-top: 0;">${heading}</h2>
        <p><strong>${escapeHtml(args.participantName)}</strong> ${action} <strong>${escapeHtml(args.eventTitle)}</strong>.</p>
        <p><strong>Task:</strong> ${escapeHtml(args.taskTitle)}</p>
        ${args.shiftName ? `<p><strong>Shift:</strong> ${escapeHtml(args.shiftName)}</p>` : ""}
        ${args.whenLine ? `<p><strong>When:</strong> ${escapeHtml(args.whenLine)}</p>` : ""}
        ${args.location ? `<p><strong>Where:</strong> ${escapeHtml(args.location)}</p>` : ""}
        ${args.comment ? `<p><strong>Participant note:</strong><br>${escapeHtml(args.comment).replace(/\r?\n/g, "<br>")}</p>` : ""}
        <p><a href="${escapeHtml(args.eventUrl)}" style="color: #2563eb;">View sign-up sheet</a></p>
        ${emailFooter(args.site)}
      </div>
    `,
  };
}

export function signupComment(customFields: string | null | undefined): string {
  try {
    const parsed = JSON.parse(customFields || "{}");
    return typeof parsed?.comment === "string" ? parsed.comment : "";
  } catch {
    return "";
  }
}
