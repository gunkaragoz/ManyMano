import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight, CalendarDays, ChevronDown, ClipboardList, Plus } from "lucide-react";
import TemplateIcon from "~/components/TemplateIcon";
import { HEADER_MENU_SLUGS, TEMPLATES, getTemplate, templatePath, type EventTemplate } from "~/utils/templates";

const MENU = HEADER_MENU_SLUGS.map(getTemplate).filter((t): t is EventTemplate => t !== null);

const GROUPS = [
  { label: "Sign-up sheets", type: "SIGNUP_SHEET", accent: "text-blue-600" },
  { label: "Meeting polls", type: "TIME_POLL", accent: "text-green-600" },
] as const;

const BLANK = [
  { to: "/create/signup", label: "Sign-up sheet", hint: "Shifts, tasks and spots", Icon: ClipboardList, tone: "bg-blue-50 text-blue-600 border-blue-100" },
  { to: "/create/poll", label: "Meeting poll", hint: "Vote on the best time", Icon: CalendarDays, tone: "bg-green-50 text-green-600 border-green-100" },
];

/**
 * The header's one call to action: "Create Event" opens a menu to start a
 * blank sheet or poll, or from one of a few templates (the hub lists them
 * all). A native <details> so every link is in the server-rendered HTML
 * (crawlable, works before hydration); the effects only add closing on
 * navigation, outside click and Escape.
 */
export default function CreateMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  const location = useLocation();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [location.key]);

  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  // Not positioned on phones, so the panel spans the (sticky) header's width
  // instead of hanging off the pill and past the screen edge.
  return (
    <details ref={ref} className="sm:relative group">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition-all">
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="sm:hidden">Create</span>
        <span className="hidden sm:inline">Create Event</span>
        <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="absolute left-4 right-4 top-full mt-1 sm:left-auto sm:right-0 sm:mt-2 sm:w-[34rem] bg-white border border-slate-200/80 rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] p-4 z-50 max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain">
        <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Start blank</p>
        <div className="grid grid-cols-2 gap-2">
          {BLANK.map(({ to, label, hint, Icon, tone }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200/80 hover:border-slate-300 hover:bg-slate-50 transition-colors"
            >
              <span className={`w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center ${tone}`}>
                <Icon className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-slate-900">{label}</span>
                <span className="hidden sm:block text-[11px] text-slate-500 truncate">{hint}</span>
              </span>
            </Link>
          ))}
        </div>
        <p className="px-2 pt-4 pb-3 text-xs text-slate-500 border-t border-slate-100 mt-4">
          <span className="font-semibold text-slate-700">Or start from a template</span> — pre-filled and fully editable.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {GROUPS.map((g) => (
            <div key={g.type}>
              <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{g.label}</p>
              <ul>
                {MENU.filter((t) => t.type === g.type).map((t) => (
                  <li key={t.slug}>
                    <Link
                      to={templatePath(t)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    >
                      <TemplateIcon icon={t.icon} className={`w-3.5 h-3.5 shrink-0 ${g.accent}`} />
                      {t.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Link
          to="/templates"
          className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-1 px-2 text-xs font-bold text-slate-600 hover:text-slate-900"
        >
          All {TEMPLATES.length} templates <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </details>
  );
}
