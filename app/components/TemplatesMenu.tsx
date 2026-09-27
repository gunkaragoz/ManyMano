import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight, ChevronDown, LayoutTemplate } from "lucide-react";
import TemplateIcon from "~/components/TemplateIcon";
import { HEADER_MENU_SLUGS, TEMPLATES, getTemplate, templatePath, type EventTemplate } from "~/utils/templates";

const MENU = HEADER_MENU_SLUGS.map(getTemplate).filter((t): t is EventTemplate => t !== null);

const GROUPS = [
  { label: "Sign-up sheets", type: "SIGNUP_SHEET", accent: "text-blue-600" },
  { label: "Meeting polls", type: "TIME_POLL", accent: "text-green-600" },
] as const;

/**
 * Header menu with a short list of template pages (the hub has them all). A native <details> so the links
 * are in the server-rendered HTML (crawlable, works before hydration); the
 * effects only add closing on navigation, outside click and Escape.
 */
export default function TemplatesMenu() {
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
      {/* Second action next to "Create Event": same pill shape, outlined. */}
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-full border border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50 shadow-sm transition-all group-open:border-slate-400">
        <LayoutTemplate className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
        <span className="sm:hidden">Templates</span>
        <span className="hidden sm:inline">Start from a template</span>
        <ChevronDown className="hidden sm:block w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="absolute left-4 right-4 top-full mt-1 sm:left-auto sm:right-0 sm:mt-2 sm:w-[34rem] bg-white border border-slate-200/80 rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] p-4 z-50 max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain">
        <p className="px-2 pb-3 text-xs text-slate-500">Pre-filled and fully editable — pick one to get started.</p>
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
