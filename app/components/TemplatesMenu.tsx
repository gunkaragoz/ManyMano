import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight, ChevronDown } from "lucide-react";
import TemplateIcon from "~/components/TemplateIcon";
import { TEMPLATES, templatePath } from "~/utils/templates";

const GROUPS = [
  { label: "Sign-up sheets", type: "SIGNUP_SHEET", accent: "text-blue-600" },
  { label: "Meeting polls", type: "TIME_POLL", accent: "text-green-600" },
] as const;

/**
 * Header menu listing every template page. A native <details> so the links
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

  return (
    <details ref={ref} className="relative group">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-full text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors">
        Templates
        <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 mt-2 w-[min(calc(100vw-2rem),34rem)] bg-white border border-slate-200/80 rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] p-4 z-50">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {GROUPS.map((g) => (
            <div key={g.type}>
              <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{g.label}</p>
              <ul>
                {TEMPLATES.filter((t) => t.type === g.type).map((t) => (
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
          All templates <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </details>
  );
}
