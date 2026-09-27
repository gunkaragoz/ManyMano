import { Link } from "react-router";
import { Copy, LayoutTemplate, TriangleAlert, X } from "lucide-react";
import type { PrefillNotice } from "~/utils/usePrefill";

/**
 * Tells the organizer where the form's contents came from (a template or a
 * copy), or why a requested template/copy couldn't be used. Dismissing it
 * never changes the form; "Start blank" resets it to a new, empty draft.
 */
export default function PrefillBanner({
  notice,
  flow,
  onDismiss,
  onStartBlank,
}: {
  notice: PrefillNotice;
  flow: "signup" | "poll";
  onDismiss: () => void;
  onStartBlank: () => void;
}) {
  const accent =
    flow === "poll"
      ? "bg-green-50 border-green-200/80 text-green-900"
      : "bg-blue-50 border-blue-200/80 text-blue-900";
  const linkClass = "font-semibold underline underline-offset-2 hover:no-underline";

  if (notice.kind === "applied") {
    const Icon = notice.source.kind === "template" ? LayoutTemplate : Copy;
    return (
      <div role="status" className={`p-4 rounded-2xl border text-sm flex items-start gap-2.5 ${accent}`}>
        <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 space-y-1">
          <p className="font-semibold">
            {notice.source.kind === "template"
              ? `Started from the ${notice.source.name} template.`
              : `Copied from “${notice.source.title}”.`}{" "}
            <span className="font-normal">
              {notice.source.kind === "template"
                ? "Edit anything before you create it."
                : flow === "poll"
                  ? "No votes were copied — edit anything before you create it."
                  : "No sign-ups were copied — edit anything before you create it."}
            </span>
          </p>
          {notice.notes.includes("allDayToHour") && (
            <p>The original poll was all day; this copy uses 1 hour. Change it below.</p>
          )}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <button type="button" onClick={onStartBlank} className={linkClass}>
              Start blank
            </button>
            <Link to="/templates" className={linkClass}>
              Browse templates
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="p-1 rounded-lg hover:bg-black/5 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const message =
    notice.kind === "missing"
      ? notice.source === "template"
        ? "That template doesn't exist anymore."
        : "That event couldn't be found — it may have been deleted or expired."
      : `This ${flow === "poll" ? "poll" : "sheet"} has a schedule the create form can't copy yet. ${notice.reason}`;

  return (
    <div role="alert" className="p-4 rounded-2xl border text-sm flex items-start gap-2.5 bg-amber-50 border-amber-200/80 text-amber-900">
      <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 space-y-1">
        <p>
          <span className="font-semibold">{message}</span> Your draft hasn&apos;t changed.
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {notice.kind === "unsupported" && notice.eventId && (
            <Link to={`/events/${notice.eventId}`} className={linkClass}>
              Back to the event
            </Link>
          )}
          <Link to="/templates" className={linkClass}>
            Browse templates
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="p-1 rounded-lg hover:bg-black/5 transition-colors shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
