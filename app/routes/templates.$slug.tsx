import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, data, isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import { ArrowRight, CalendarDays, Check, ClipboardList } from "lucide-react";
import NotFound from "~/components/NotFound";
import TemplateIcon from "~/components/TemplateIcon";
import {
  TEMPLATES_HUB_NAME,
  TEMPLATE_CATEGORIES,
  describePollOptions,
  describeShiftDays,
  describeTemplateSchedule,
  getTemplate,
  relatedTemplates,
  templateCreatePath,
  templatePath,
} from "~/utils/templates";
import { formatDurationLabel } from "~/utils/calendar";
import { formatTimeDisplay } from "~/utils/pollTitles";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  mergeParentMeta,
  pageMetaOverrides,
  rootSiteFromMatches,
  truncate,
} from "~/utils/seo";

export async function loader({ params }: LoaderFunctionArgs) {
  const t = getTemplate(params.slug);
  if (!t) throw new Response("Template not found", { status: 404 });

  const preview =
    t.type === "SIGNUP_SHEET"
      ? {
          kind: "signup" as const,
          shifts: t.prefill.shifts.map((s) => ({
            name: s.name,
            time: s.startTime ? `${formatTimeDisplay(s.startTime)} – ${formatTimeDisplay(s.endTime)}` : "",
            days: describeShiftDays(t, s.days),
            tasks: s.tasks,
          })),
        }
      : {
          kind: "poll" as const,
          duration: formatDurationLabel(t.poll.durationMinutes),
          options: describePollOptions(t),
        };

  return data({
    template: {
      slug: t.slug,
      type: t.type,
      name: t.name,
      icon: t.icon,
      category: TEMPLATE_CATEGORIES.find((c) => c.key === t.category)?.label ?? "",
      seo: t.seo,
      schedule: describeTemplateSchedule(t),
      path: templatePath(t),
      createPath: templateCreatePath(t),
    },
    preview,
    related: relatedTemplates(t).map((r) => ({
      slug: r.slug,
      type: r.type,
      name: r.name,
      tagline: r.tagline,
      icon: r.icon,
      path: templatePath(r),
    })),
  });
}

export const meta: MetaFunction<typeof loader> = ({ matches, loaderData }) => {
  const site = rootSiteFromMatches(matches);
  if (!loaderData) {
    return mergeParentMeta(matches, [
      ...pageMetaOverrides({
        title: `Template not found | ${site.siteName}`,
        description: "That template doesn't exist. Browse all sign-up sheet and poll templates.",
        path: "/templates",
        robots: "noindex, nofollow",
        siteUrl: site.siteUrl,
      }),
    ]);
  }
  const t = loaderData.template;
  return mergeParentMeta(matches, [
    ...pageMetaOverrides({
      title: truncate(`${t.seo.title} | ${site.siteName}`, 70),
      description: t.seo.description,
      path: t.path,
      siteUrl: site.siteUrl,
    }),
    {
      "script:ld+json": breadcrumbJsonLd(
        [
          { name: "Home", path: "/" },
          { name: TEMPLATES_HUB_NAME, path: "/templates" },
          { name: t.seo.h1, path: t.path },
        ],
        site.siteUrl
      ),
    },
    { "script:ld+json": faqPageJsonLd(t.seo.faqs) },
  ]);
};

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <NotFound
        title="This template couldn't be found"
        message="The link may be wrong or the template was renamed. You'll be taken back to the main page shortly."
      />
    );
  }
  throw error;
}

export default function TemplatePage() {
  const { template: t, preview, related } = useLoaderData<typeof loader>();
  const isPoll = t.type === "TIME_POLL";
  const accentButton = isPoll ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700";

  const steps = isPoll
    ? [
        { title: "Open the template", body: "The poll form opens with the title, duration and options filled in. Add, remove or move any option." },
        { title: "Add your name and email", body: "Create the poll and get two links: one to share, and a private one for you to manage it." },
        {
          title: "Share, vote, lock the time",
          body: "Everyone votes Yes, Maybe or No on each option. When the best time is clear, lock it in — voters can add it to their calendars.",
        },
      ]
    : [
        { title: "Open the template", body: "The sign-up form opens with the dates, shifts, tasks and spots filled in. Change anything you like." },
        { title: "Add your name and email", body: "Create the sheet and get two links: one to share, and a private one for you to manage sign-ups." },
        {
          title: "Share the link",
          body: "People claim a spot with just their name — no account. You see who signed up and can export the list any time.",
        },
      ];

  return (
    <article className="max-w-3xl mx-auto space-y-10 py-6">
      <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
        <Link to="/" className="hover:text-slate-800">Home</Link>
        <span aria-hidden="true" className="mx-1.5">/</span>
        <Link to="/templates" className="hover:text-slate-800">{TEMPLATES_HUB_NAME}</Link>
        <span aria-hidden="true" className="mx-1.5">/</span>
        <span className="text-slate-700">{t.seo.h1}</span>
      </nav>

      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <span
            className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
              isPoll ? "bg-green-50 text-green-600 border-green-100" : "bg-blue-50 text-blue-600 border-blue-100"
            }`}
          >
            <TemplateIcon icon={t.icon} className="w-6 h-6" />
          </span>
          <span className="text-xs font-semibold text-slate-500 inline-flex items-center gap-1.5">
            {isPoll ? <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" /> : <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />}
            {isPoll ? "Meeting poll" : "Sign-up sheet"} · {t.category}
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">{t.seo.h1}</h1>
        {t.seo.intro.map((p) => (
          <p key={p} className="text-base text-slate-600 leading-relaxed">{p}</p>
        ))}
        <Link
          to={t.createPath}
          className={`inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-white font-bold text-sm shadow-sm transition-all ${accentButton}`}
        >
          Use this template <ArrowRight className="w-4 h-4" />
        </Link>
        <p className="text-xs text-slate-500">Free · No account needed · Edit anything before you share</p>
      </header>

      <section className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">What&apos;s in this template</h2>
          <p className="text-xs text-slate-500 mt-0.5">{t.schedule}</p>
        </div>
        {preview.kind === "signup" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th scope="col" className="py-2 pr-3 font-bold">Shift</th>
                  <th scope="col" className="py-2 pr-3 font-bold">Time</th>
                  <th scope="col" className="py-2 font-bold">Tasks (spots)</th>
                </tr>
              </thead>
              <tbody>
                {preview.shifts.map((s, i) => (
                  <tr key={i} className="border-b border-slate-50 align-top">
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-slate-800">{s.name || "—"}</span>
                      {s.days && <span className="block text-[11px] text-slate-400">{s.days}</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-600 whitespace-nowrap">{s.time || "Any time"}</td>
                    <td className="py-2.5 text-slate-600">
                      {s.tasks.map((task) => `${task.title} (${task.capacity})`).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">Each option lasts {preview.duration}. Voters answer Yes, Maybe or No for each one.</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {preview.options.map((o) => (
                <li key={o} className="text-sm text-slate-700 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2">{o}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">How it works</h2>
        <ol className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {steps.map((step, i) => (
            <li key={step.title} className="space-y-1.5">
              <span
                className={`w-7 h-7 rounded-full text-white text-xs font-extrabold flex items-center justify-center ${
                  isPoll ? "bg-green-600" : "bg-blue-600"
                }`}
              >
                {i + 1}
              </span>
              <h3 className="text-sm font-bold text-slate-900">{step.title}</h3>
              <p className="text-xs text-slate-600 leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Tips</h2>
        <ul className="space-y-2">
          {t.seo.tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2.5 text-sm text-slate-600 leading-relaxed">
              <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center">
                <Check className="w-3 h-3" aria-hidden="true" />
              </span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Questions</h2>
        {t.seo.faqs.map((item) => (
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

      <div className="text-center space-y-2 pt-2">
        <Link
          to={t.createPath}
          className={`inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-white font-bold text-sm shadow-sm transition-all ${accentButton}`}
        >
          Use the {t.name.toLowerCase()} template <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <section className="pt-6 border-t border-slate-200/60 space-y-4">
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">More templates</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {related.map((r) => (
            <li key={r.slug}>
              <Link
                to={r.path}
                className="h-full bg-white border border-slate-200/80 rounded-2xl p-4 hover:border-slate-300 transition-all flex items-start gap-3"
              >
                <TemplateIcon icon={r.icon} className={`w-5 h-5 shrink-0 ${r.type === "TIME_POLL" ? "text-green-600" : "text-blue-600"}`} />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{r.name}</span>
                  <span className="block text-xs text-slate-500">{r.tagline}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/templates" className="text-sm font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">
          See all templates <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </section>
    </article>
  );
}
