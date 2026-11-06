import { getCloudflareEnv } from "~/utils/cloudflare-context";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, data, useLoaderData } from "react-router";
import { ArrowRight, Check } from "lucide-react";
import TemplateIcon from "~/components/TemplateIcon";
import BrandName from "~/components/BrandName";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  getPageMeta,
  mergeParentMeta,
  pageMetaOverrides,
  rootSiteFromMatches,
} from "~/utils/seo";
import { getSiteConfig } from "~/utils/site";
import {
  COMPETITOR,
  LAST_CHECKED,
  SOURCES,
  comparisonRows,
  doodleFaq,
  featuredTemplates,
} from "~/utils/doodle-comparison";

// /doodle-alternative: comparison landing page (see seo/LOG.md).
// Copy lives in ~/utils/doodle-comparison so it stays brand-templated and
// testable.

export async function loader({ context }: LoaderFunctionArgs) {
  const { siteName } = getSiteConfig(getCloudflareEnv(context));
  return data({
    siteName,
    rows: comparisonRows(),
    faq: doodleFaq(siteName),
    templates: featuredTemplates(),
  });
}

export const meta: MetaFunction<typeof loader> = ({ matches, loaderData }) => {
  const site = rootSiteFromMatches(matches);
  const page = getPageMeta(site.siteName).doodleAlternative;
  return mergeParentMeta(matches, [
    ...pageMetaOverrides({ ...page, siteUrl: site.siteUrl }),
    {
      "script:ld+json": breadcrumbJsonLd(
        [
          { name: "Home", path: "/" },
          { name: `${COMPETITOR} alternative`, path: page.path },
        ],
        site.siteUrl
      ),
    },
    { "script:ld+json": faqPageJsonLd(loaderData?.faq ?? doodleFaq(site.siteName)) },
  ]);
};

const card = "bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)]";
const primaryButton =
  "inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-white font-bold text-sm shadow-sm transition-all bg-green-600 hover:bg-green-700";

export default function DoodleAlternative() {
  const { siteName, rows, faq, templates } = useLoaderData<typeof loader>();

  return (
    <article className="max-w-3xl mx-auto space-y-12 py-6">
      <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
        <Link to="/" className="hover:text-slate-800">Home</Link>
        <span aria-hidden="true" className="mx-1.5">/</span>
        <span className="text-slate-700">{COMPETITOR} alternative</span>
      </nav>

      <header className="space-y-4">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          A free {COMPETITOR} alternative. No ads. No accounts.
        </h1>
        <p className="text-base text-slate-600 leading-relaxed">
          Find a time that works for everyone without a dozen reply-all emails. {siteName} gives your group a meeting
          poll where people mark each option Yes, Maybe, or No—without ads, and without anyone creating an account.
        </p>
        <p className="text-base text-slate-600 leading-relaxed">
          Add a few dates and times, share the link, and watch the best option rise to the top. When you&apos;re ready,
          lock it in and everyone can add it to their calendar.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/create/poll" className={primaryButton}>
            Create a free meeting poll <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/templates"
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl font-bold text-sm text-slate-700 bg-white border border-slate-200 hover:border-slate-400 transition-all"
          >
            Browse templates
          </Link>
        </div>
        <p className="text-xs text-slate-500">Free to use · No ads · No organizer or participant accounts</p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          {siteName} vs. {COMPETITOR}
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Both tools help a group agree on a time. {siteName} focuses on simple, free polls and sign-up sheets.{" "}
          {COMPETITOR} is a broader scheduling suite, with booking pages, calendar connections, and video-call
          integrations, and keeps several poll features for paid plans.
        </p>
        {/* One table for every width: on phones each row stacks (feature on
            top, the two answers side by side) so neither column scrolls away. */}
        <div className={`${card} !p-0 overflow-hidden`}>
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="grid grid-cols-2 gap-x-4 px-5 sm:table-row sm:px-0 text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th scope="col" className="hidden sm:table-cell py-3 pl-6 pr-3 font-bold">Feature</th>
                <th scope="col" className="py-3 sm:pr-3 font-bold text-slate-700">
                  <BrandName name={siteName} />
                </th>
                <th scope="col" className="py-3 sm:pr-6 font-bold">{COMPETITOR}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.feature}
                  className="grid grid-cols-2 gap-x-4 px-5 py-3 sm:table-row sm:p-0 border-b border-slate-50 last:border-0 align-top"
                >
                  <th scope="row" className="col-span-2 pb-1 sm:table-cell sm:py-3 sm:pl-6 sm:pr-3 font-semibold text-slate-800">
                    {r.feature}
                  </th>
                  <td className="sm:py-3 sm:pr-3 text-slate-700">{r.ours}</td>
                  <td className="sm:py-3 sm:pr-6 text-slate-600">{r.theirs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          {COMPETITOR} plan details are based on its{" "}
          {SOURCES.map((s, i) => (
            <span key={s.url}>
              {i > 0 && (i === SOURCES.length - 1 ? ", and " : ", ")}
              <a href={s.url} rel="nofollow noopener" target="_blank" className="underline hover:text-slate-800">
                {s.label}
              </a>
            </span>
          ))}
          . Last checked {LAST_CHECKED}.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Run every poll you need, free</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          A PTA meeting, a carpool planning call, and a book club night can all be open at the same time. There&apos;s
          no one-poll limit and no upgrade screen when you start the next one.
        </p>
        <p className="text-sm text-slate-600 leading-relaxed">
          Every {siteName} poll is ad-free, for you and for everyone you invite, so the options and votes stay at the
          center of the page on a phone or a computer.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Start a poll without signing up</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          You don&apos;t need a username or password. Enter your email when you create the poll and you get two links:
          one to share with your group and a private organizer link for managing it.
        </p>
        <p className="text-sm text-slate-600 leading-relaxed">
          Participants don&apos;t need an account either. They enter a name and mark each time. If they come back on
          the same device, they can change their answers.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">See the best time and lock it in</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Yes means a time works; Maybe means it could work if needed. The poll highlights the option with the most
          support, counting a Yes more than a Maybe. While the poll is open, anyone can suggest a time you didn&apos;t
          think of.
        </p>
        <p className="text-sm text-slate-600 leading-relaxed">
          Times appear in your time zone, and anyone in a different time zone also sees their local time. When you lock the winning time, everyone who left an email gets the date with links to add it to
          Google Calendar, Apple Calendar, or Outlook.
        </p>
      </section>

      <section className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Start with a poll that fits your group</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Choose a template with sensible days and times already filled in. Change the options, title, and
            description before creating your poll.
          </p>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {templates.map((t) => (
            <li key={t.slug}>
              <Link
                to={t.path}
                className="h-full bg-white border border-slate-200/80 rounded-2xl p-4 hover:border-green-300 transition-all flex items-start gap-3"
              >
                <TemplateIcon icon={t.icon} className="w-5 h-5 shrink-0 text-green-600" />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{t.label}</span>
                  <span className="block text-xs text-slate-500">{t.blurb}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/templates" className="text-sm font-semibold text-green-600 hover:text-green-700 inline-flex items-center gap-1">
          Find your template <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Which tool fits your group?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={`${card} !p-6 space-y-2`}>
            <h3 className="text-sm font-bold text-slate-900">Choose {siteName}</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              when you want free, ad-free polls for a school group, club, team, or family, as many as you need, and
              you&apos;d like everyone—including the organizer—to get started without an account.
            </p>
          </div>
          <div className={`${card} !p-6 space-y-2`}>
            <h3 className="text-sm font-bold text-slate-900">Choose {COMPETITOR}</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              when you want to connect your calendar to spot conflicts, set voting deadlines, hide participants from
              each other, or offer booking pages for one-on-one meetings. Some of these require a paid plan.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Questions about switching</h2>
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

      <section className={`${card} text-center space-y-3`}>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Your next meeting poll can be simpler</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Add a few dates and times, share one link, and lock in the time that works.
        </p>
        <Link to="/create/poll" className={primaryButton}>
          Create a free meeting poll <ArrowRight className="w-4 h-4" />
        </Link>
        <p className="text-xs text-slate-500 inline-flex items-center justify-center gap-1.5 w-full">
          <Check className="w-3.5 h-3.5" aria-hidden="true" /> No ads. No accounts. Free to use.
        </p>
      </section>
    </article>
  );
}
