import type { MetaFunction } from "react-router";
import { Link, data, useLoaderData } from "react-router";
import { useState } from "react";
import { ArrowRight, CalendarDays, ClipboardList } from "lucide-react";
import TemplateIcon from "~/components/TemplateIcon";
import {
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATES_HUB_NAME,
  describeTemplateSchedule,
  templatePath,
  type TemplateCategory,
} from "~/utils/templates";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  faqPageJsonLd,
  getPageMeta,
  mergeParentMeta,
  pageMetaOverrides,
  rootSiteFromMatches,
  type FaqItem,
} from "~/utils/seo";

const HUB_FAQ: FaqItem[] = [
  {
    question: "Are the templates free?",
    answer:
      "Yes. Every template is free to use, with no account, no ads and no limit on how many sign-up sheets or polls you create.",
  },
  {
    question: "Can I change a template before sharing it?",
    answer:
      "Yes. A template only fills in the create form — the title, dates, shifts, tasks and spots are all editable before you create the event.",
  },
  {
    question: "Can I reuse an event I already made?",
    answer:
      "Yes. Open any event and choose Make a copy. You get the same structure with new dates and no sign-ups or votes.",
  },
];

export async function loader() {
  return data({
    templates: TEMPLATES.map((t) => ({
      slug: t.slug,
      type: t.type,
      name: t.name,
      tagline: t.tagline,
      category: t.category,
      icon: t.icon,
      schedule: describeTemplateSchedule(t),
      path: templatePath(t),
    })),
    faq: HUB_FAQ,
  });
}

export const meta: MetaFunction<typeof loader> = ({ matches, loaderData }) => {
  const site = rootSiteFromMatches(matches);
  const page = getPageMeta(site.siteName).templates;
  const templates = loaderData?.templates ?? [];
  return mergeParentMeta(matches, [
    ...pageMetaOverrides({ ...page, siteUrl: site.siteUrl }),
    {
      "script:ld+json": breadcrumbJsonLd(
        [
          { name: "Home", path: "/" },
          { name: TEMPLATES_HUB_NAME, path: "/templates" },
        ],
        site.siteUrl
      ),
    },
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: templates.map((t, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: t.name,
          url: absoluteUrl(t.path, site.siteUrl),
        })),
      },
    },
    { "script:ld+json": faqPageJsonLd(loaderData?.faq ?? HUB_FAQ) },
  ]);
};

type TypeFilter = "all" | "SIGNUP_SHEET" | "TIME_POLL";

const TYPE_FILTERS: Array<{ key: TypeFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "SIGNUP_SHEET", label: "Sign-up sheets" },
  { key: "TIME_POLL", label: "Meeting polls" },
];

export default function TemplatesHub() {
  const { templates, faq } = useLoaderData<typeof loader>();
  const [type, setType] = useState<TypeFilter>("all");
  const [category, setCategory] = useState<TemplateCategory | "all">("all");
  const shown = templates.filter(
    (t) => (type === "all" || t.type === type) && (category === "all" || t.category === category)
  );
  const categories = TEMPLATE_CATEGORIES.filter((c) =>
    templates.some((t) => t.category === c.key && (type === "all" || t.type === type))
  );

  const pill = (active: boolean) =>
    `px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
      active
        ? "bg-slate-900 text-white border-slate-900"
        : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
    }`;

  return (
    <div className="max-w-4xl mx-auto space-y-10 py-6">
      <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
        <Link to="/" className="hover:text-slate-800">Home</Link>
        <span aria-hidden="true" className="mx-1.5">/</span>
        <span className="text-slate-700">{TEMPLATES_HUB_NAME}</span>
      </nav>

      <div className="text-center space-y-3 max-w-2xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Free sign-up sheet and meeting poll templates
        </h1>
        <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
          Start from a ready-made sheet or poll for school events, fundraisers, teams and friends. A template fills in
          the form — you can change anything before you share the link. No accounts, no ads.
        </p>
      </div>

      <div className="space-y-3">
        <div role="group" aria-label="Template type" className="flex flex-wrap justify-center gap-2">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={type === f.key}
              onClick={() => {
                setType(f.key);
                setCategory("all");
              }}
              className={pill(type === f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Category" className="flex flex-wrap justify-center gap-2">
          <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")} className={pill(category === "all")}>
            Any category
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={category === c.key}
              onClick={() => setCategory(c.key)}
              className={pill(category === c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map((t) => {
          const isPoll = t.type === "TIME_POLL";
          return (
            <li key={t.slug}>
              <Link
                to={t.path}
                className={`group h-full bg-white border border-slate-200/80 rounded-3xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all flex flex-col gap-3 ${
                  isPoll ? "hover:border-green-300" : "hover:border-blue-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${
                      isPoll ? "bg-green-50 text-green-600 border-green-100" : "bg-blue-50 text-blue-600 border-blue-100"
                    }`}
                  >
                    <TemplateIcon icon={t.icon} className="w-5 h-5" />
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${
                      isPoll ? "text-green-700" : "text-blue-700"
                    }`}
                  >
                    {isPoll ? <CalendarDays className="w-3 h-3" aria-hidden="true" /> : <ClipboardList className="w-3 h-3" aria-hidden="true" />}
                    {isPoll ? "Poll" : "Sign-up"}
                  </span>
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900">{t.name}</h2>
                  <p className="text-xs text-slate-500 leading-relaxed">{t.tagline}</p>
                </div>
                <p className="text-[11px] text-slate-400 mt-auto">{t.schedule}</p>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="text-center text-sm text-slate-600">
        Don&apos;t see what you need?{" "}
        <Link to="/create" className="font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">
          Start from a blank event <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <section className="max-w-3xl mx-auto pt-6 border-t border-slate-200/60 space-y-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight text-center">Questions about templates</h2>
        {faq.map((item) => (
          <details
            key={item.question}
            className="group bg-white border border-slate-200/80 rounded-2xl px-6 py-4 shadow-[0_2px_12px_rgba(0,0,0,0.03)]"
          >
            <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-sm font-semibold text-slate-800">
              {item.question}
              <span aria-hidden="true" className="text-slate-500 group-open:rotate-45 transition-transform text-lg leading-none">
                +
              </span>
            </summary>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">{item.answer}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
