import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Link, useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Globe2,
  ThumbsUp,
  Users,
  Vote,
} from "lucide-react";
import { useEffect, useState } from "react";
import { DailyChart, Donut, HBar, Sparkline } from "~/components/pulse-charts";
import { clampPulseDays, getPulseStats, PULSE_DAY_OPTIONS, type PulseStats } from "~/utils/pulse";
import {
  breadcrumbJsonLd,
  mergeParentMeta,
  pageMetaOverrides,
  rootSiteFromMatches,
} from "~/utils/seo";
import { detectLocalTimezone, formatUtcOffsetShort, timezoneCity } from "~/utils/timezones";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-09" -> { m: 9, d: 9, y: 2026 } (no Date math, no TZ shift). */
function splitIsoDay(iso: string): { m: number; d: number; y: number } | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Compact human range: "Sep 9 → 15, 2026" / "Aug 28 → Sep 15, 2026". */
function prettyRange(start: string, end: string): string {
  const s = splitIsoDay(start);
  const e = splitIsoDay(end);
  if (!s || !e) return `${start} → ${end}`;
  if (s.y === e.y && s.m === e.m) return `${MONTHS[s.m - 1]} ${s.d} → ${e.d}, ${e.y}`;
  if (s.y === e.y) return `${MONTHS[s.m - 1]} ${s.d} → ${MONTHS[e.m - 1]} ${e.d}, ${e.y}`;
  return `${MONTHS[s.m - 1]} ${s.d}, ${s.y} → ${MONTHS[e.m - 1]} ${e.d}, ${e.y}`;
}

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers();
  const cacheControl = loaderHeaders.get("Cache-Control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return headers;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as { DB: D1Database };
  const days = clampPulseDays(new URL(request.url).searchParams.get("days"));
  let stats: PulseStats;
  try {
    stats = await getPulseStats(env.DB, days);
  } catch {
    throw new Response("Stats temporarily unavailable.", { status: 500 });
  }
  return json(
    { stats },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}

export const meta: MetaFunction<typeof loader> = ({ data, matches }) => {
  const site = rootSiteFromMatches(matches);
  const title = `Pulse — live activity | ${site.siteName}`;
  const description =
    "Live counts of events, sign-ups and votes, daily trends and timezone spread. Aggregate stats only — no personal data.";
  return mergeParentMeta(matches, [
    ...pageMetaOverrides({ title, description, path: "/pulse", siteUrl: site.siteUrl }),
    {
      "script:ld+json": breadcrumbJsonLd(
        [
          { name: "Home", path: "/" },
          { name: "Pulse", path: "/pulse" },
        ],
        site.siteUrl
      ),
    },
  ]);
};

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400 text-[11px] font-medium">—</span>;
  const up = value >= 0;
  return (
    <span
      className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
        up ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(value)}%
    </span>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  delta,
  spark,
  sparkColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  delta?: number | null;
  spark: number[];
  sparkColor: string;
}) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-3xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-500">
          {icon}
          <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
        </div>
        {delta !== undefined && <Delta value={delta} />}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums leading-none">
            {value}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 leading-snug">{sub}</div>
        </div>
        <div className="shrink-0 opacity-90">
          <Sparkline values={spark} stroke={sparkColor} label={`${label} trend`} />
        </div>
      </div>
    </div>
  );
}

const SERIES_META = {
  events: { label: "Events", color: "#2563eb", swatch: "bg-blue-600" },
  signups: { label: "Sign-ups", color: "#16a34a", swatch: "bg-green-600" },
  votes: { label: "Votes", color: "#9333ea", swatch: "bg-purple-600" },
} as const;
type SeriesKey = keyof typeof SERIES_META;

export default function Pulse() {
  const { stats } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const switching = navigation.state !== "idle";
  const [visible, setVisible] = useState<SeriesKey[]>(["events", "signups", "votes"]);
  const [localTz, setLocalTz] = useState<string | null>(null);
  useEffect(() => setLocalTz(detectLocalTimezone()), []);

  const toggle = (k: SeriesKey) =>
    setVisible((v) => (v.includes(k) ? (v.length > 1 ? v.filter((x) => x !== k) : v) : [...v, k]));

  const dailyTotals = stats.daily.map((d) => d.events + d.signups + d.votes);
  const peak = stats.daily.reduce((m, d) => Math.max(m, d.events + d.signups + d.votes), 0);
  const peakDay = stats.daily.find((d) => d.events + d.signups + d.votes === peak && peak > 0);
  const isEmpty = stats.totals.events === 0;
  const minOff = stats.offsetSpread.min;
  const maxOff = stats.offsetSpread.max;
  const fmtOff = (m: number) => {
    const sign = m < 0 ? "−" : "+";
    const abs = Math.abs(m);
    const h = Math.floor(abs / 60);
    const mm = abs % 60;
    return mm === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(mm).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-8 py-2">
      {/* Hero */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 border border-green-200/70 text-green-700 text-xs font-semibold">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            Live · updated just now
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            ManyMano <span className="text-blue-600">Pulse</span>
          </h1>
          <p className="text-sm text-slate-500 max-w-xl leading-relaxed">
            Every event created, spot claimed and vote cast — counted in public.{" "}
            <span className="whitespace-nowrap font-medium text-slate-600">
              {prettyRange(stats.rangeStart, stats.rangeEnd)} · UTC
            </span>
            . Aggregate only, no personal data.
            {localTz && (
              <span className="mt-1 block text-[13px]">
                You&apos;re viewing from{" "}
                <span
                  className="whitespace-nowrap font-semibold text-slate-700"
                  title={localTz}
                >
                  {timezoneCity(localTz)}
                  {formatUtcOffsetShort(localTz) ? ` (${formatUtcOffsetShort(localTz)})` : ""}
                </span>
                .
              </span>
            )}
          </p>
        </div>
        <div
          className="inline-flex items-center gap-1 p-1 rounded-full bg-white border border-slate-200/80 shadow-sm self-start"
          role="group"
          aria-label="Time range"
        >
          {PULSE_DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              disabled={switching}
              onClick={() => navigate(`/pulse?days=${d}`)}
              aria-pressed={stats.days === d}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all tabular-nums ${
                stats.days === d
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {isEmpty ? (
        <div className="bg-white border border-slate-200/80 rounded-3xl p-10 text-center space-y-4 shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
          <Activity className="w-10 h-10 mx-auto text-slate-300" />
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">No activity yet</h2>
            <p className="text-sm text-slate-500">
              The pulse starts beating with the first event. Be the one.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3 pt-1">
            <Link
              to="/create/signup"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-all"
            >
              Create sign-up sheet <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/create/poll"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-all"
            >
              Create meeting poll <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi
              icon={<CalendarDays className="w-4 h-4" />}
              label="Events"
              value={stats.totals.events}
              sub={`${stats.totals.signupSheets} sheets · ${stats.totals.polls} polls · ${stats.active7d.events} this week`}
              delta={stats.deltas.events}
              spark={stats.daily.map((d) => d.events)}
              sparkColor="#2563eb"
            />
            <Kpi
              icon={<Users className="w-4 h-4" />}
              label="Sign-ups"
              value={stats.totals.signups}
              sub={`~${stats.engagement.avgSignupsPerSheet} per sheet · ${stats.active7d.signups} this week`}
              delta={stats.deltas.signups}
              spark={stats.daily.map((d) => d.signups)}
              sparkColor="#16a34a"
            />
            <Kpi
              icon={<Vote className="w-4 h-4" />}
              label="Votes"
              value={stats.totals.votes}
              sub={`~${stats.engagement.avgVotesPerPoll} per poll · ${stats.active7d.votes} this week`}
              delta={stats.deltas.votes}
              spark={stats.daily.map((d) => d.votes)}
              sparkColor="#9333ea"
            />
            <Kpi
              icon={<Globe2 className="w-4 h-4" />}
              label="Timezones"
              value={stats.totals.timezones}
              sub={
                minOff !== null && maxOff !== null
                  ? `Spanning ${fmtOff(minOff)} → ${fmtOff(maxOff)} · ${stats.totals.slots} slots`
                  : `${stats.totals.slots} time slots proposed`
              }
              spark={dailyTotals}
              sparkColor="#0ea5e9"
            />
          </div>

          {/* Daily trends */}
          <section className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-5 min-w-0 overflow-hidden">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">Daily activity</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {peakDay
                    ? `Peak: ${peak} actions on ${peakDay.label} · dashed line is the 7-day average`
                    : "Dashed line is the 7-day average"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {(Object.keys(SERIES_META) as SeriesKey[]).map((k) => {
                  const on = visible.includes(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => toggle(k)}
                      aria-pressed={on}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                        on
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${SERIES_META[k].swatch}`} />
                      {SERIES_META[k].label}
                    </button>
                  );
                })}
              </div>
            </div>
            <DailyChart days={stats.daily} series={visible} />
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-500">
              <span>
                <span className="font-bold text-slate-800 tabular-nums">
                  {stats.daily.reduce((s, d) => s + d.events, 0)}
                </span>{" "}
                events in window
              </span>
              <span>
                <span className="font-bold text-slate-800 tabular-nums">
                  {stats.daily.reduce((s, d) => s + d.signups, 0)}
                </span>{" "}
                sign-ups in window
              </span>
              <span>
                <span className="font-bold text-slate-800 tabular-nums">
                  {stats.daily.reduce((s, d) => s + d.votes, 0)}
                </span>{" "}
                votes in window
              </span>
            </div>
          </section>

          {/* Timezones + mix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <Globe2 className="w-5 h-5 text-sky-600" /> Spanning timezones
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Organizer timezones across {stats.totals.timezones} zone{stats.totals.timezones === 1 ? "" : "s"}
                  {minOff !== null && maxOff !== null && ` · ${fmtOff(minOff)} to ${fmtOff(maxOff)}`}
                </p>
              </div>
              {stats.timezones.length === 0 ? (
                <p className="text-sm text-slate-400">No timezone data yet.</p>
              ) : (
                <ul className="space-y-3.5">
                  {stats.timezones.map((t) => (
                    <li key={t.timezone} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate font-semibold text-slate-800">
                          {t.city}{" "}
                          <span className="font-normal text-slate-400">
                            {t.region}{t.offsetLabel ? ` · ${t.offsetLabel}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-500">
                          <span className="font-bold text-slate-800">{t.count}</span> · {t.pct}%
                        </span>
                      </div>
                      <HBar pct={t.pct} color="#0ea5e9" label={`${t.city}: ${t.count} events`} />
                    </li>
                  ))}
                </ul>
              )}
              {stats.regions.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {stats.regions.map((r) => (
                    <span
                      key={r.region}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-50 border border-sky-100 text-[11px] font-semibold text-sky-800"
                    >
                      {r.region} · {r.pct}%
                    </span>
                  ))}
                </div>
              )}
              <div className="pt-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  UTC coverage
                </div>
                <div className="flex items-end gap-1.5 h-14" role="img" aria-label="UTC offset coverage histogram">
                  {stats.offsetSpread.bins.map((b) => {
                    const m = Math.max(...stats.offsetSpread.bins.map((x) => x.count), 1);
                    return (
                      <div key={b.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                        <div
                          className="w-full rounded-md bg-gradient-to-t from-sky-500 to-cyan-300 min-h-[3px]"
                          style={{ height: `${Math.max(6, (b.count / m) * 44)}px`, opacity: b.count ? 1 : 0.25 }}
                          title={`${b.label}: ${b.count} zones`}
                        />
                        <span className="text-[9px] text-slate-400 whitespace-nowrap">{b.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <div className="space-y-4">
              <section className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-4">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">Event mix</h2>
                <Donut
                  segments={[
                    { value: stats.totals.signupSheets, color: "#2563eb", name: "Sign-up sheets" },
                    { value: stats.totals.polls, color: "#16a34a", name: "Meeting polls" },
                  ]}
                  label={`${stats.totals.signupSheets} sign-up sheets, ${stats.totals.polls} meeting polls`}
                />
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-2xl bg-blue-50/60 border border-blue-100 p-3">
                    <ClipboardList className="w-4 h-4 mx-auto text-blue-600" />
                    <div className="text-xl font-extrabold text-slate-900 tabular-nums mt-1">
                      {stats.engagement.avgSignupsPerSheet}
                    </div>
                    <div className="text-[11px] text-slate-500">sign-ups / sheet</div>
                  </div>
                  <div className="rounded-2xl bg-green-50/60 border border-green-100 p-3">
                    <Vote className="w-4 h-4 mx-auto text-green-600" />
                    <div className="text-xl font-extrabold text-slate-900 tabular-nums mt-1">
                      {stats.engagement.avgVotesPerPoll}
                    </div>
                    <div className="text-[11px] text-slate-500">votes / poll</div>
                  </div>
                </div>
              </section>

              <section className="bg-white border border-slate-200/80 rounded-3xl p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-4">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <ThumbsUp className="w-5 h-5 text-purple-600" /> Engagement
                </h2>
                <div className="space-y-3.5 text-xs">
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-700">Yes responses</span>
                      <span className="tabular-nums text-slate-500">
                        <span className="font-bold text-slate-800">{stats.totals.yes}</span> ·{" "}
                        {stats.engagement.yesPct}%
                      </span>
                    </div>
                    <HBar pct={stats.engagement.yesPct} color="#16a34a" label={`Yes: ${stats.engagement.yesPct}%`} />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-700">Maybe responses</span>
                      <span className="tabular-nums text-slate-500">
                        <span className="font-bold text-slate-800">{stats.totals.maybe}</span> ·{" "}
                        {stats.engagement.maybePct}%
                      </span>
                    </div>
                    <HBar pct={stats.engagement.maybePct} color="#f59e0b" label={`Maybe: ${stats.engagement.maybePct}%`} />
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <span className="font-semibold text-slate-700">Polls locked in</span>
                    <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                      {stats.totals.finalized} <span className="text-xs font-semibold text-slate-500">({stats.engagement.finalizePct}%)</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-500">
                    <span>Avg. options per event</span>
                    <span className="font-bold text-slate-800 tabular-nums">{stats.engagement.avgSlotsPerEvent}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <p className="text-center text-[11px] text-slate-400 pt-2">
            Aggregate counts only — no names, emails or event titles. Events auto-expire after 90 days,
            so windows beyond that reflect retention, not history. Data:{" "}
            <Link to="/api/pulse" className="underline hover:text-slate-600">/api/pulse</Link>
          </p>
        </>
      )}
    </div>
  );
}
