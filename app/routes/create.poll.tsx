import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation, Link } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, TriangleAlert, X } from "lucide-react";
import { usePersistentState } from "~/utils/usePersistentState";
import DatePicker from "~/components/DatePicker";
import { useCreateStickyHeader, formatStickyDate } from "~/utils/useCreateStickyHeader";
import { getDb, events, eventSlots } from "~/db";
import { eq } from "drizzle-orm";
import {
  generateInternalId,
  generateSecretToken,
  generateUniquePublicId,
} from "~/utils/ids";
import { sendEmail } from "~/utils/email";
import { escapeHtml } from "~/utils/sanitize";
import { buildAdminCookie, hashSecretForStorage } from "~/utils/auth";
import { pruneExpiredEvents } from "~/utils/retention";
import { addMinutesToTimeString, formatSlotDateLabel, formatDurationLabel } from "~/utils/calendar";
import {
  PAGE_META,
  breadcrumbJsonLd,
  mergeParentMeta,
  pageMetaOverrides,
} from "~/utils/seo";

export const meta: MetaFunction = ({ matches }) => {
  return mergeParentMeta(matches, [
    ...pageMetaOverrides(PAGE_META.createPoll),
    {
      "script:ld+json": breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Create", path: "/create" },
        { name: "Meeting Poll", path: "/create/poll" },
      ]),
    },
  ]);
};

export async function loader({ request }: LoaderFunctionArgs) {
  return json({});
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function formatTimeDisplay(t: string): string {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as { DB: D1Database; RESEND_API_KEY?: string; FROM_EMAIL?: string };
  const db = getDb(env.DB);
  try {
    await pruneExpiredEvents(db);
  } catch {}
  const formData = await request.formData();

  const title = (formData.get("title") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const location = (formData.get("location") as string)?.trim() || null;
  const organizerName = (formData.get("organizerName") as string)?.trim();
  const organizerEmail = (formData.get("organizerEmail") as string)?.trim();
  const timezone = (formData.get("timezone") as string)?.trim() || "UTC";

  if (!title) {
    return json({ error: "Please enter a meeting title." }, { status: 400 });
  }
  if (!organizerName) {
    return json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!organizerEmail || !organizerEmail.includes("@")) {
    return json({ error: "A valid email is required to receive your secret management link." }, { status: 400 });
  }

  // Single duration for the whole poll. "allday" (or missing) => NULL = All day.
  const durationRaw = ((formData.get("durationMinutes") as string) || "").trim().toLowerCase();
  let durationMinutes: number | null = 60;
  if (durationRaw === "allday" || durationRaw === "all-day" || durationRaw === "") {
    durationMinutes = null;
  } else {
    const parsed = parseInt(durationRaw, 10);
    if (Number.isNaN(parsed) || parsed < 5 || parsed > 1440) {
      return json({ error: "Please pick a valid duration (5–1440 minutes) or All day." }, { status: 400 });
    }
    durationMinutes = parsed;
  }

  const slotDates = formData.getAll("slotDate") as string[];
  const slotStartTimes = formData.getAll("slotStartTime") as string[];
  const slotEndTimes = formData.getAll("slotEndTime") as string[];
  const slotLabels = formData.getAll("slotTitle") as string[];

  const validSlots: Array<{
    slotDate: string;
    startTime: string | null;
    endTime: string | null;
    title: string;
    displayOrder: number;
  }> = [];

  for (let idx = 0; idx < slotDates.length; idx++) {
    const date = (slotDates[idx] || "").trim();
    if (!date) continue;
    if (!DATE_RE.test(date)) {
      return json({ error: `Row ${idx + 1}: please pick a valid day.` }, { status: 400 });
    }
    const label = (slotLabels[idx] || "").trim();
    if (durationMinutes === null) {
      validSlots.push({
        slotDate: date,
        startTime: null,
        endTime: null,
        title: label || `${formatSlotDateLabel(date)} · All day`,
        displayOrder: validSlots.length,
      });
      continue;
    }
    const start = (slotStartTimes[idx] || "").trim();
    if (!TIME_RE.test(start)) {
      return json({ error: `Row ${idx + 1}: please pick a start time.` }, { status: 400 });
    }
    const explicitEnd = (slotEndTimes[idx] || "").trim();
    const end =
      explicitEnd && TIME_RE.test(explicitEnd)
        ? explicitEnd
        : addMinutesToTimeString(start, durationMinutes);
    validSlots.push({
      slotDate: date,
      startTime: start,
      endTime: end,
      title: label || `${formatSlotDateLabel(date)} · ${formatTimeDisplay(start)} – ${formatTimeDisplay(end)}`,
      displayOrder: validSlots.length,
    });
  }

  if (validSlots.length === 0) {
    return json({ error: "Please add at least one day." }, { status: 400 });
  }

  const sortedDates = [...validSlots].map((s) => s.slotDate).sort();
  const firstDate = sortedDates[0];

  const eventId = await generateUniquePublicId(async (candidate) => {
    const existing = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, candidate))
      .limit(1);
    return existing.length > 0;
  });
  const adminToken = generateSecretToken();
  const adminTokenStored = await hashSecretForStorage(adminToken);
  const now = new Date().toISOString();

  await db.insert(events).values({
    id: eventId,
    type: "TIME_POLL",
    title,
    eventDate: firstDate,
    description,
    location,
    organizerName,
    organizerEmail,
    adminToken: adminTokenStored,
    status: "OPEN",
    settings: JSON.stringify({}),
    timezone,
    durationMinutes,
    createdAt: now,
    updatedAt: now,
  });

  for (const slot of validSlots) {
    await db.insert(eventSlots).values({
      id: generateInternalId(),
      eventId,
      title: slot.title,
      capacity: 999,
      slotDate: slot.slotDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
      displayOrder: slot.displayOrder,
    });
  }

  const url = new URL(request.url);
  const adminUrl = `${url.origin}/events/${eventId}?admin=${adminToken}`;
  const publicUrl = `${url.origin}/events/${eventId}`;

  const proposedList = [...validSlots]
    .sort((a, b) => (a.slotDate + (a.startTime || "")).localeCompare(b.slotDate + (b.startTime || "")))
    .slice(0, 8)
    .map((s) => `<li>${escapeHtml(s.title)}</li>`)
    .join("");
  const moreCount = validSlots.length > 8 ? `<p>…and ${validSlots.length - 8} more option(s).</p>` : "";
  const durationLabel = formatDurationLabel(durationMinutes);

  await sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.FROM_EMAIL,
    to: organizerEmail,
    subject: `Your meeting poll: "${title}" is live!`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 0;">Your meeting poll "${escapeHtml(title)}" is ready!</h2>
        <p>Hi ${escapeHtml(organizerName)},</p>
        <p>Here are your links:</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 18px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 0 0 12px 0;"><strong>Share with Attendees to Vote:</strong><br><a href="${escapeHtml(publicUrl)}" style="color: #2563eb;">${escapeHtml(publicUrl)}</a></p>
          <p style="margin: 0;"><strong>Secret Management Link (Keep Private!):</strong><br><a href="${escapeHtml(adminUrl)}" style="color: #2563eb;">${escapeHtml(adminUrl)}</a></p>
        </div>
        <p><strong>Duration:</strong> ${escapeHtml(durationLabel)} &nbsp;·&nbsp; <strong>Days:</strong> ${validSlots.length}</p>
        <ul>${proposedList}</ul>
        ${moreCount}
        <p style="font-size: 13px; color: #64748b;">Use your secret management link to see live vote tallies, lock the winning time, and generate calendar invites. You can delete it anytime from Organizer Admin Mode.</p>
        <p style="margin-top: 24px; font-weight: 600;">— ManyMano</p>
      </div>
    `,
  });

  const headers = new Headers();
  headers.append("Set-Cookie", buildAdminCookie(eventId, adminToken));
  return redirect(`/events/${eventId}?admin=${adminToken}&created=1`, { headers });
}

type PollDetails = {
  title: string;
  description: string;
  location: string;
  organizerName: string;
  organizerEmail: string;
  timezone: string;
};

type DayRow = {
  id: number;
  date: string;
  startTime: string;
  label: string;
};

const POLL_DETAILS_KEY = "manymano:create-poll:details:v2";
const POLL_DAYS_KEY = "manymano:create-poll:days:v2";
const POLL_DURATION_KEY = "manymano:create-poll:duration:v2";

const PRESET_DURATIONS = [
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hr" },
  { minutes: 120, label: "2 hrs" },
];

const TIMEZONES = [
  "UTC",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultDays(): DayRow[] {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return [
    { id: 1, date: toISODate(today), startTime: "10:00", label: "" },
    { id: 2, date: toISODate(tomorrow), startTime: "10:00", label: "" },
  ];
}

export default function CreateMeetingPoll() {
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [details, setDetails, clearDetails] = usePersistentState<PollDetails>(
    POLL_DETAILS_KEY,
    () => ({
      title: "",
      description: "",
      location: "",
      organizerName: "",
      organizerEmail: "",
      timezone: "UTC",
    })
  );
  const [days, setDays, clearDays] = usePersistentState<DayRow[]>(POLL_DAYS_KEY, defaultDays);
  const [durationMinutes, setDurationMinutes, clearDuration] = usePersistentState<number | null>(
    POLL_DURATION_KEY,
    () => 60
  );
  const [customMinutes, setCustomMinutes] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  // Auto-detect browser timezone once (client only, never clobbers a saved draft).
  // Also normalizes any legacy "All day" draft to the 1 hr default.
  useEffect(() => {
    if (durationMinutes === null) setDurationMinutes(60);
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected && details.timezone === "UTC" && (TIMEZONES as string[]).includes(detected)) {
        setDetails((prev) => (prev.timezone === "UTC" ? { ...prev, timezone: detected } : prev));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wasSubmitting = useRef(false);
  const titleSentinelRef = useRef<HTMLDivElement>(null);
  const firstDate = useMemo(
    () => [...days].map((d) => d.date).filter(Boolean).sort()[0] || "",
    [days]
  );
  useCreateStickyHeader(details.title, firstDate, titleSentinelRef);
  useEffect(() => {
    if (navigation.state === "submitting") {
      wasSubmitting.current = true;
    } else if (navigation.state === "loading" && wasSubmitting.current) {
      wasSubmitting.current = false;
      clearDetails();
      clearDays();
      clearDuration();
    } else if (navigation.state === "idle") {
      wasSubmitting.current = false;
    }
  }, [navigation.state, clearDetails, clearDays, clearDuration]);

  const updateDetails = (patch: Partial<PollDetails>) =>
    setDetails((prev) => ({ ...prev, ...patch }));

  const startOver = () => {
    clearDetails();
    clearDays();
    clearDuration();
    setDays(defaultDays());
    setDurationMinutes(60);
    setCustomMinutes("");
    setShowCustom(false);
  };

  const MAX_OPTIONS = 31;

  const dayKey = (date: string, start: string) => `${date}||${start}`;

  const addDay = () => {
    setDays((prev) => {
      if (prev.length >= MAX_OPTIONS) return prev;
      const lastDate = [...prev].map((d) => d.date).filter(Boolean).sort().pop();
      let nextDate = "";
      if (lastDate && DATE_RE.test(lastDate)) {
        const [y, m, day] = lastDate.split("-").map(Number);
        const d = new Date(y, m - 1, day);
        d.setDate(d.getDate() + 1);
        nextDate = toISODate(d);
      } else {
        nextDate = toISODate(new Date());
      }
      const lastStart = prev.length > 0 ? prev[prev.length - 1].startTime || "10:00" : "10:00";
      if (prev.some((d) => dayKey(d.date, d.startTime) === dayKey(nextDate, lastStart))) return prev;
      return [...prev, { id: Date.now(), date: nextDate, startTime: lastStart, label: "" }];
    });
  };

  /** Bulk-add: appends the next 7 calendar days after the latest row, same start time. */
  const addNext7Days = () => {
    setDays((prev) => {
      if (prev.length >= MAX_OPTIONS) return prev;
      const existing = new Set(prev.map((d) => dayKey(d.date, d.startTime)));
      const lastDate = [...prev].map((d) => d.date).filter(Boolean).sort().pop();
      let base: Date;
      if (lastDate && DATE_RE.test(lastDate)) {
        const [y, m, day] = lastDate.split("-").map(Number);
        base = new Date(y, m - 1, day);
      } else {
        base = new Date();
      }
      const baseStart =
        [...prev].sort((a, b) => a.date.localeCompare(b.date)).pop()?.startTime || "10:00";
      const next = [...prev];
      for (let i = 1; i <= 7 && next.length < MAX_OPTIONS; i++) {
        const d = new Date(base);
        d.setDate(base.getDate() + i);
        const iso = toISODate(d);
        if (existing.has(dayKey(iso, baseStart))) continue;
        existing.add(dayKey(iso, baseStart));
        next.push({ id: Date.now() + i, date: iso, startTime: baseStart, label: "" });
      }
      return next;
    });
  };

  /** Adds the next consecutive time block on the same day, right after the given row. */
  const addHourAfter = (id: number) => {
    setDays((prev) => {
      if (prev.length >= MAX_OPTIONS) return prev;
      const idx = prev.findIndex((d) => d.id === id);
      if (idx === -1) return prev;
      const row = prev[idx];
      const step = durationMinutes ?? 60;
      const existing = new Set(prev.map((d) => dayKey(d.date, d.startTime)));
      let candidate = TIME_RE.test(row.startTime) ? addMinutesToTimeString(row.startTime, step) : row.startTime;
      for (let tries = 0; tries < 24; tries++) {
        if (!existing.has(dayKey(row.date, candidate))) break;
        candidate = addMinutesToTimeString(candidate, step);
      }
      if (existing.has(dayKey(row.date, candidate))) return prev;
      const inserted = { id: Date.now(), date: row.date, startTime: candidate, label: "" };
      return [...prev.slice(0, idx + 1), inserted, ...prev.slice(idx + 1)];
    });
  };

  const removeDay = (id: number) => {
    if (days.length <= 1) return;
    setDays((prev) => prev.filter((d) => d.id !== id));
  };

  const updateDay = (id: number, patch: Partial<Omit<DayRow, "id">>) => {
    setDays((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const applyCustom = () => {
    const parsed = parseInt(customMinutes, 10);
    if (!Number.isNaN(parsed) && parsed >= 5 && parsed <= 1440) {
      setDurationMinutes(parsed);
      setShowCustom(false);
    }
  };

  const isAllDay = durationMinutes === null;
  const endFor = (start: string) =>
    durationMinutes === null || !TIME_RE.test(start) ? "" : addMinutesToTimeString(start, durationMinutes);

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-4">
      <div className="space-y-2">
        <Link to="/" className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Home</span>
        </Link>
        <div className="flex items-center gap-3 pt-1">
          <div className="w-10 h-10 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center border border-green-100">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Create Meeting Time Poll
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Pick a duration, add days, and let attendees vote on their availability.
            </p>
          </div>
        </div>
      </div>

      {actionData?.error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 text-sm font-medium flex items-center gap-2">
          <TriangleAlert className="w-4 h-4 shrink-0" />
          <span>{actionData.error}</span>
        </div>
      )}

      <Form method="post" className="bg-white border border-slate-200/80 rounded-3xl p-8 sm:p-10 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-10">
        <input type="hidden" name="durationMinutes" value={durationMinutes === null ? "allday" : String(durationMinutes)} />
        <div className="relative pl-9 space-y-8">
          <div aria-hidden="true" className="absolute left-3 top-3 bottom-3 w-px bg-green-100" />
          {/* Step 1: Meeting Details */}
          <div className="relative space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="absolute -left-9 top-0 w-6 h-6 rounded-full bg-green-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0 ring-4 ring-white">
                  1
                </span>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Meeting Details
                </label>
              </div>
              <span className="text-[11px] text-slate-400" title="Your draft is saved in this tab and survives refresh. It clears after successful creation.">
                Draft auto-saved in this tab
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Meeting Title *
                </label>
                <input
                  type="text"
                  name="title"
                  required
                  value={details.title}
                  onChange={(e) => updateDetails({ title: e.target.value })}
                  placeholder="e.g., Q4 Product Roadmap & Sprint Planning"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Timezone
                  </label>
                  <select
                    name="timezone"
                    value={TIMEZONES.includes(details.timezone) ? details.timezone : "UTC"}
                    onChange={(e) => updateDetails({ timezone: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-800 bg-white"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Video Link or Location (Optional)
                  </label>
                  <input
                    type="text"
                    name="location"
                    value={details.location}
                    onChange={(e) => updateDetails({ location: e.target.value })}
                    placeholder="e.g., https://meet.google.com/xyz or Room 302"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div ref={titleSentinelRef} aria-hidden="true" className="h-px w-full" />

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Meeting Agenda / Notes (Optional)
                </label>
                <textarea
                  name="description"
                  rows={3}
                  value={details.description}
                  onChange={(e) => updateDetails({ description: e.target.value })}
                  placeholder="Topics to discuss, preparation materials, or meeting objectives..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400 leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Your Name *
                  </label>
                  <input
                    type="text"
                    name="organizerName"
                    required
                    value={details.organizerName}
                    onChange={(e) => updateDetails({ organizerName: e.target.value })}
                    placeholder="e.g., David Kim"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Your Email *
                  </label>
                  <input
                    type="email"
                    name="organizerEmail"
                    required
                    value={details.organizerEmail}
                    onChange={(e) => updateDetails({ organizerEmail: e.target.value })}
                    placeholder="david@example.com"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    We'll email your private admin link here to finalize the meeting.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Step 2: Duration */}
          <div className="relative space-y-4">
            <div className="flex items-center gap-2">
              <span className="absolute -left-9 top-0 w-6 h-6 rounded-full bg-green-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0 ring-4 ring-white">
                2
              </span>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Duration
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESET_DURATIONS.map((p) => (
                <button
                  key={p.minutes}
                  type="button"
                  onClick={() => {
                    setDurationMinutes(p.minutes);
                    setShowCustom(false);
                  }}
                  className={`px-4 py-2 rounded-lg border text-sm font-semibold transition-all ${
                    durationMinutes === p.minutes
                      ? "bg-blue-800 text-white border-blue-800"
                      : "bg-white text-slate-800 border-slate-200 hover:border-blue-400"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCustom((v) => !v)}
                className={`px-4 py-2 rounded-lg border text-sm font-semibold transition-all inline-flex items-center gap-1.5 ${
                  showCustom || (durationMinutes !== null && !PRESET_DURATIONS.some((p) => p.minutes === durationMinutes))
                    ? "border-blue-700 text-blue-700"
                    : "bg-white text-blue-700 border-blue-600 hover:bg-blue-50"
                }`}
              >
                <span className="text-base leading-none">+</span> Custom duration
                {durationMinutes !== null && !PRESET_DURATIONS.some((p) => p.minutes === durationMinutes) && (
                  <span className="font-normal">· {formatDurationLabel(durationMinutes)}</span>
                )}
              </button>
            </div>
            {(showCustom || (durationMinutes !== null && !PRESET_DURATIONS.some((p) => p.minutes === durationMinutes))) && (
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={
                    durationMinutes !== null && !PRESET_DURATIONS.some((p) => p.minutes === durationMinutes)
                      ? String(durationMinutes)
                      : customMinutes
                  }
                  onChange={(e) => {
                    setCustomMinutes(e.target.value);
                    const parsed = parseInt(e.target.value, 10);
                    if (!Number.isNaN(parsed) && parsed >= 5 && parsed <= 1440) {
                      setDurationMinutes(parsed);
                    }
                  }}
                  placeholder="e.g., 45"
                  className="w-32 px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <span className="text-xs text-slate-500">minutes (5–1440)</span>
                {(() => {
                  const parsed = parseInt(
                    durationMinutes !== null && !PRESET_DURATIONS.some((p) => p.minutes === durationMinutes)
                      ? String(durationMinutes)
                      : customMinutes,
                    10
                  );
                  return !Number.isNaN(parsed) && parsed >= 5 && parsed <= 1440 ? (
                    <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                      = {formatDurationLabel(parsed)}
                    </span>
                  ) : null;
                })()}
                {showCustom && (
                  <button
                    type="button"
                    onClick={applyCustom}
                    className="px-3 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Apply
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Add your times */}
          <div className="relative space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="absolute -left-9 top-0 w-6 h-6 rounded-full bg-green-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0 ring-4 ring-white">
                    3
                  </span>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Add your times
                  </label>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Add one or more days. {isAllDay ? "Attendees vote on whole days." : `Each option lasts ${formatDurationLabel(durationMinutes)}.`}{" "}
                  {days.length} option{days.length === 1 ? "" : "s"} so far.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={addNext7Days}
                  title="Append the next 7 calendar days with the same start time"
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-2xl border border-slate-200 hover:border-green-400 hover:text-green-600 bg-white transition-all shadow-sm flex items-center gap-1 shrink-0"
                >
                  <span>+ Next 7 days</span>
                </button>
                <button
                  type="button"
                  onClick={addDay}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-2xl border border-slate-200 hover:border-green-400 hover:text-green-600 bg-white transition-all shadow-sm flex items-center gap-1 shrink-0"
                >
                  <span>+ Add day</span>
                </button>
              </div>
            </div>

            <div className="space-y-3.5">
              {days.map((day, index) => {
                const end = endFor(day.startTime);
                return (
                  <div
                    key={day.id}
                    className="p-4 bg-slate-50/70 rounded-2xl border border-slate-200/80 transition-all space-y-3"
                  >
                    <input type="hidden" name="slotDate" value={day.date} />
                    <input type="hidden" name="slotStartTime" value={isAllDay ? "" : day.startTime} />
                    <input type="hidden" name="slotEndTime" value={isAllDay ? "" : end} />
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700">
                        Option {index + 1}
                        {day.date && (
                          <span className="ml-2 font-semibold text-slate-500">
                            {formatStickyDate(day.date)}
                            {!isAllDay && day.startTime && end && (
                              <> · {formatTimeDisplay(day.startTime)} – {formatTimeDisplay(end)}</>
                            )}
                            {isAllDay && <> · All day</>}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-3 shrink-0">
                        {!isAllDay && (
                          <button
                            type="button"
                            onClick={() => addHourAfter(day.id)}
                            title={`Add the next ${formatDurationLabel(durationMinutes)} block on the same day`}
                            className="text-green-700 hover:text-green-800 font-bold text-xs transition-colors inline-flex items-center gap-1"
                          >
                            + Add hour
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeDay(day.id)}
                          disabled={days.length <= 1}
                          className="text-slate-400 hover:text-rose-500 font-bold text-xs disabled:opacity-20 transition-colors inline-flex items-center gap-1"
                        >
                          Remove <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                      <div className={isAllDay ? "sm:col-span-6" : "sm:col-span-4"}>
                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                          Day *
                        </label>
                        <DatePicker
                          value={day.date}
                          onChange={(iso) => updateDay(day.id, { date: iso })}
                        />
                      </div>

                      {!isAllDay && (
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                            Start time *
                          </label>
                          <input
                            type="time"
                            required
                            value={day.startTime}
                            onChange={(e) => updateDay(day.id, { startTime: e.target.value })}
                            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                          />
                        </div>
                      )}

                      {!isAllDay && (
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                            Ends
                          </label>
                          <div className="w-full px-3 py-2 text-xs rounded-xl border border-slate-100 bg-slate-100/70 text-slate-600 font-semibold">
                            {end ? formatTimeDisplay(end) : "—"}
                          </div>
                        </div>
                      )}

                      <div className={isAllDay ? "sm:col-span-6" : "sm:col-span-3"}>
                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                          Label (optional)
                        </label>
                        <input
                          type="text"
                          name="slotTitle"
                          placeholder="e.g., Kickoff"
                          value={day.label}
                          onChange={(e) => updateDay(day.id, { label: e.target.value })}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
          <button
            type="button"
            onClick={startOver}
            className="px-5 py-3 rounded-2xl text-xs font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-300 bg-white transition-all"
          >
            Start over (clear draft)
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-bold text-sm shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Creating Poll...</span>
              </>
            ) : (
              <span className="inline-flex items-center gap-2">Create Meeting Poll & Get Links <ArrowRight className="w-4 h-4" /></span>
            )}
          </button>
        </div>
      </Form>
    </div>
  );
}
