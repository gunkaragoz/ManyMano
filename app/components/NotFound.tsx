import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { FileQuestion } from "lucide-react";

export const NOT_FOUND_REDIRECT_SECONDS = 20;

type NotFoundProps = {
  title?: string;
  message?: string;
  redirectTo?: string;
  redirectSeconds?: number;
};

/**
 * Friendly 404/410 page: explains the link may be wrong or the event was
 * deleted/expired, then redirects to the main page after N seconds.
 * The countdown is cancellable by unmount (navigation) and announced politely.
 */
export default function NotFound({
  title = "This page couldn't be found",
  message = "The link may be wrong, or the event was deleted or expired.",
  redirectTo = "/",
  redirectSeconds = NOT_FOUND_REDIRECT_SECONDS,
}: NotFoundProps) {
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState(redirectSeconds);

  // Reset if the reason changes (e.g. navigating between two bad event ids).
  useEffect(() => {
    setSecondsLeft(redirectSeconds);
  }, [redirectSeconds, title]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      navigate(redirectTo);
      return;
    }
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [secondsLeft, navigate, redirectTo]);

  const progress = Math.max(0, Math.min(1, secondsLeft / redirectSeconds));

  return (
    <div className="max-w-xl mx-auto text-center py-12 md:py-16">
      <div className="bg-white border border-slate-200/80 rounded-3xl px-8 py-10 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-5">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center border border-slate-200">
          <FileQuestion className="w-6 h-6" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">404 — Not found</p>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
          <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-slate-500">
          Redirecting to the main page in{" "}
          <span className="font-semibold tabular-nums text-slate-800" aria-label={`${secondsLeft} seconds`}>
            {secondsLeft}s
          </span>
          …
        </p>
        {/* Countdown progress bar */}
        <div
          className="h-1.5 rounded-full bg-slate-100 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={redirectSeconds}
          aria-valuenow={secondsLeft}
          aria-label="Redirect countdown"
        >
          <div
            className="h-full rounded-full bg-blue-600 transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
          <Link
            to={redirectTo}
            className="w-full sm:w-auto text-center py-2.5 px-5 rounded-2xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            Go to main page now
          </Link>
          <Link
            to="/create"
            className="w-full sm:w-auto text-center py-2.5 px-5 rounded-2xl bg-white border border-slate-200 text-slate-700 font-semibold text-sm hover:border-slate-300 hover:bg-slate-50 transition-all"
          >
            Create a new event
          </Link>
        </div>
      </div>
    </div>
  );
}
