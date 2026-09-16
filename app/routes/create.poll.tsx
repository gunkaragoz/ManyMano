import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useLoaderData, useNavigation, Link } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, TriangleAlert, X } from "lucide-react";
import { usePersistentState } from "~/utils/usePersistentState";
import DatePicker from "~/components/DatePicker";
import TimePicker from "~/components/TimePicker";
import TimezoneSelect from "~/components/TimezoneSelect";
import { detectLocalTimezone } from "~/utils/timezones";
import { useCreateStickyHeader } from "~/utils/useCreateStickyHeader";
import { getDb, events, eventSlots } from "~/db";
import { eq } from "drizzle-orm";
import {
  generateInternalId,
  generateSecretToken,
  generateUniquePublicId,
} from "~/utils/ids";
import { sendEmail, emailFooter, getEmailSenderConfig } from "~/utils/email";
import { trackEmailUsage, getEmailLimits } from "~/utils/quota";
import { escapeHtml } from "~/utils/sanitize";
import { buildAdminCookie, hashSecretForStorage } from "~/utils/auth";
import { verifyTurnstile, turnstileFailure } from "~/utils/turnstile";
import Turnstile from "~/components/Turnstile";
import {
  DESCRIPTION_MAX,
  EMAIL_MAX,
  LOCATION_MAX,
  MAX_SLOTS_PER_EVENT,
  ORGANIZER_NAME_MAX,
  SLOT_TITLE_MAX,
  TITLE_MAX,
  cleanText,
  isPastIsoDate,
  isValidEmail,
  isValidIsoDate,
  parseTimezoneInput,
} from "~/utils/validation";
import { pruneExpiredEvents } from "~/utils/retention";
import { getSiteConfig } from "~/utils/site";
import { addMinutesToTimeString, formatSlotDateLabel, formatLongDateLabel, formatDurationLabel } from "~/utils/calendar";
import {
  getPageMeta,
  breadcrumbJsonLd,
  mergeParentMeta,
  pageMetaOverrides,
  rootSiteFromMatches,
} from "~/utils/seo";

export const meta: MetaFunction = ({ matches }) => {
  const site = rootSiteFromMatches(matches);
  const page = getPageMeta(site.siteName).createPoll;
  return mergeParentMeta(matches, [
    ...pageMetaOverrides({ ...page, siteUrl: site.siteUrl }),
    {
      "script:ld+json": breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Create", path: "/create" },
        { name: "Meeting Poll", path: "/create/poll" },
      ], site.siteUrl),
    },
  ]);
};

export async function loader({ context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as {
    TURNSTILE_SITE_KEY?: string;
  };
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null });
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
  const env = context.cloudflare.env as {
    DB: D1Database;
    EMAIL_PROVIDER?: string;
    RESEND_API_KEY?: string;
    SMTP_HOST?: string;
    SMTP_PORT?: string;
    SMTP_USERNAME?: string;
    SMTP_PASSWORD?: string;
    SMTP_SECURE?: string;
    EMAIL_DAILY_LIMIT?: string;
    EMAIL_MONTHLY_LIMIT?: string;
    ALERT_WEBHOOK_URL?: string;
    FROM_EMAIL: string;
    SITE_URL: string;
    SITE_NAME: string;
    SITE_TAGLINE: string;
    SITE_DESCRIPTION: string;
    GITHUB_REPO_URL?: string;
    FOOTER_CREDIT_URL?: string;
    FOOTER_CREDIT_LABEL?: string;
    SECURITY_CONTACT?: string;
    ICS_UID_DOMAIN?: string;
    ICS_PRODID?: string;
    TURNSTILE_SECRET_KEY?: string;
    TURNSTILE_HOSTNAMES?: string;
  };
  const site = getSiteConfig(env);
  const db = getDb(env.DB);
  try {
    await pruneExpiredEvents(db);
  } catch {}
  const formData = await request.formData();

  const title = cleanText(formData.get("title"), TITLE_MAX);
  const description = cleanText(formData.get("description"), DESCRIPTION_MAX) || null;
  const location = cleanText(formData.get("location"), LOCATION_MAX) || null;
  const organizerName = cleanText(formData.get("organizerName"), ORGANIZER_NAME_MAX);
  const organizerEmail = cleanText(formData.get("organizerEmail"), EMAIL_MAX);
  const timezone = parseTimezoneInput(formData.get("timezone") as string);

  if (!title) {
    return json({ error: "Please enter a meeting title." }, { status: 400 });
  }
  if (!timezone) {
    return json({ error: "Please pick a timezone from the list." }, { status: 400 });
  }
  if (!organizerName) {
    return json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!isValidEmail(organizerEmail)) {
    return json({ error: "A valid email is required to receive your secret management link." }, { status: 400 });
  }

  // Bot protection before any DB work.
  const turnstile = await verifyTurnstile({
    token: formData.get("cf-turnstile-response") as string | null,
    expectedAction: "create-poll",
    env,
    remoteIp: request.headers.get("cf-connecting-ip"),
  });
  if (!turnstile.ok) {
    const f = turnstileFailure();
    return json(f.body, { status: f.status });
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

  if (slotDates.length > MAX_SLOTS_PER_EVENT) {
    return json(
      { error: `Too many options — maximum ${MAX_SLOTS_PER_EVENT} per poll.` },
      { status: 400 }
    );
  }

  const seenOptions = new Set<string>();
  for (let idx = 0; idx < slotDates.length; idx++) {
    if (validSlots.length >= MAX_SLOTS_PER_EVENT) break;
    const date = (slotDates[idx] || "").trim();
    if (!date) continue;
    if (!DATE_RE.test(date) || !isValidIsoDate(date)) {
      return json({ error: `Row ${idx + 1}: please pick a valid day.` }, { status: 400 });
    }
    if (isPastIsoDate(date)) {
      return json({ error: `Row ${idx + 1}: that day has already passed.` }, { status: 400 });
    }
    const optionKey = `${date}|${durationMinutes === null ? "" : (slotStartTimes[idx] || "").trim()}`;
    if (seenOptions.has(optionKey)) {
      return json({ error: `Row ${idx + 1}: this day and time is already in the poll.` }, { status: 400 });
    }
    seenOptions.add(optionKey);
    const label = cleanText(slotLabels[idx], SLOT_TITLE_MAX);
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
    // One duration for the whole poll: the end is always derived from it, so
    // a posted end time can't contradict the start (overnight wrap is fine).
    const end = addMinutesToTimeString(start, durationMinutes);
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
  // Auto-generated QR code (PNG) encoding the public link for flyers/door signs.
  const qrUrl = `${publicUrl}/qr?format=png`;

  const proposedList = [...validSlots]
    .sort((a, b) => (a.slotDate + (a.startTime || "")).localeCompare(b.slotDate + (b.startTime || "")))
    .slice(0, 8)
    .map((s) => {
      const dayLabel = formatLongDateLabel(s.slotDate);
      const timeLabel = s.startTime
        ? `${formatTimeDisplay(s.startTime)}${s.endTime ? ` – ${formatTimeDisplay(s.endTime)}` : ""}`
        : "All day";
      return `<li>${escapeHtml(dayLabel)} · ${escapeHtml(timeLabel)}</li>`;
    })
    .join("");
  const moreCount = validSlots.length > 8 ? `<p>…and ${validSlots.length - 8} more option(s).</p>` : "";
  const durationLabel = formatDurationLabel(durationMinutes);

  const emailResult = await sendEmail({
    ...getEmailSenderConfig(env),
    from: site.fromEmail,
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
        <div style="text-align: center; margin: 20px 0;">
          <p style="margin: 0 0 8px 0;"><strong>QR code for your event page:</strong></p>
          <a href="${escapeHtml(publicUrl)}"><img src="${escapeHtml(qrUrl)}" alt="QR code linking to your event page" width="180" height="180" style="width: 180px; height: 180px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 6px; background: #ffffff;" /></a>
          <p style="margin: 8px 0 0 0; font-size: 13px; color: #64748b;">Scan to open the event page — print it on flyers or show it at the door.</p>
        </div>
        <p><strong>Duration:</strong> ${escapeHtml(durationLabel)} &nbsp;·&nbsp; <strong>Days:</strong> ${validSlots.length}</p>
        ${description ? `<p><strong>Description:</strong><br>${escapeHtml(description).replace(/\r?\n/g, "<br>")}</p>` : ""}
        <ul>${proposedList}</ul>
        ${moreCount}
        <p style="font-size: 13px; color: #64748b;">Use your secret management link to see live vote tallies, lock the winning time, and generate calendar invites. You can delete it anytime from Organizer Admin Mode.</p>
        ${emailFooter(site)}
      </div>
    `,
  });
  // Free-tier quota tracking: counts the send, fires a Discord/Slack webhook
  // at 80/90/100% (best-effort, never blocks the redirect).
  await trackEmailUsage(env.DB, {
    webhookUrl: env.ALERT_WEBHOOK_URL,
    appName: site.siteName,
    result: emailResult,
    limits: getEmailLimits(emailResult.provider, env),
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
  const { turnstileSiteKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  // Floating toast for validation errors. The inline banner below sits at the
  // top of a long form, so after clicking Create at the bottom the error was
  // off-screen. A fixed-viewport toast is always visible; the inline banner
  // stays as a persistent fallback.
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  // Ref to the email field so email validation errors can move focus to it.
  const emailRef = useRef<HTMLInputElement>(null);
  const emailError = Boolean(actionData?.error && /email/i.test(actionData.error));
  useEffect(() => {
    if (actionData?.error) {
      setToast({ text: actionData.error, key: Date.now() });
      if (/email/i.test(actionData.error)) {
        const t = window.setTimeout(() => {
          emailRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          emailRef.current?.focus({ preventScroll: true });
        }, 50);
        return () => window.clearTimeout(t);
      }
    }
  }, [actionData]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

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
    const detected = detectLocalTimezone();
    if (detected && details.timezone === "UTC") {
      setDetails((prev) => (prev.timezone === "UTC" ? { ...prev, timezone: detected } : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wasSubmitting = useRef(false);
  const titleSentinelRef = useRef<HTMLDivElement>(null);
  // Polls have no event date — sticky header shows the title only.
  useCreateStickyHeader(details.title, "", titleSentinelRef);
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
    <div className="w-full max-w-4xl mx-auto space-y-8 py-4">
      {toast && (
        <div
          key={toast.key}
          role="alert"
          aria-live="assertive"
          className="fixed bottom-6 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md p-4 rounded-2xl border shadow-lg flex items-center gap-2.5 text-sm font-semibold animate-toast-in bg-rose-50 border-rose-200/80 text-rose-800"
        >
          <TriangleAlert className="w-4 h-4 shrink-0" />
          <span className="flex-1">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="p-1 rounded-lg hover:bg-black/5 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
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
              Pick a duration, add days, and let attendees vote on their availability. No account needed. Your email receives your private organizer link — lose it and you can get a new one from the event page.
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
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all placeholder:text-slate-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="poll-timezone" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Timezone
                  </label>
                  <TimezoneSelect
                    id="poll-timezone"
                    name="timezone"
                    value={details.timezone || "UTC"}
                    onChange={(timezone) => updateDetails({ timezone })}
                    accent="green"
                  />
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
                    className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all placeholder:text-slate-400"
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
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all placeholder:text-slate-400 leading-relaxed"
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
                    className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all placeholder:text-slate-400"
                  />
                </div>

                <div>
                  <label htmlFor="organizer-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Your Email *
                  </label>
                  <input
                    ref={emailRef}
                    id="organizer-email"
                    type="email"
                    name="organizerEmail"
                    required
                    aria-invalid={emailError}
                    value={details.organizerEmail}
                    onChange={(e) => updateDetails({ organizerEmail: e.target.value })}
                    placeholder="david@example.com"
                    className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-all placeholder:text-slate-400 ${
                      emailError
                        ? "border-rose-400 focus:ring-rose-500/20 focus:border-rose-500"
                        : "border-slate-200/90 focus:ring-green-500/20 focus:border-green-500"
                    }`}
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    No account needed. Your email receives your private organizer link (never shown publicly or shared). Lose it and you can get a new one from the event page — the old link will stop working.
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
                      ? "bg-green-600 text-white border-green-600"
                      : "bg-white text-slate-800 border-slate-200 hover:border-green-500"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (showCustom) {
                    setShowCustom(false);
                  } else {
                    setCustomMinutes(
                      durationMinutes !== null &&
                        !PRESET_DURATIONS.some((p) => p.minutes === durationMinutes)
                        ? String(durationMinutes)
                        : ""
                    );
                    setShowCustom(true);
                  }
                }}
                className={`px-4 py-2 rounded-lg border text-sm font-semibold transition-all inline-flex items-center gap-1.5 ${
                  showCustom || (durationMinutes !== null && !PRESET_DURATIONS.some((p) => p.minutes === durationMinutes))
                    ? "border-green-700 text-green-700 bg-green-50"
                    : "bg-white text-green-700 border-green-600 hover:bg-green-50"
                }`}
              >
                <span className="text-base leading-none">+</span> Custom duration
                {durationMinutes !== null && !PRESET_DURATIONS.some((p) => p.minutes === durationMinutes) && (
                  <span className="font-normal">· {formatDurationLabel(durationMinutes)}</span>
                )}
              </button>
            </div>
            {showCustom && (
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyCustom();
                    }
                  }}
                  placeholder="e.g., 45"
                  className="w-32 px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
                <span className="text-xs text-slate-500">minutes (5–1440)</span>
                {(() => {
                  const parsed = parseInt(customMinutes, 10);
                  if (!Number.isNaN(parsed) && parsed >= 5 && parsed <= 1440) {
                    return (
                      <span className="text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
                        = {formatDurationLabel(parsed)}
                      </span>
                    );
                  }
                  return customMinutes.trim() !== "" ? (
                    <span className="text-xs font-semibold text-rose-600">
                      Enter a value between 5 and 1440
                    </span>
                  ) : null;
                })()}
                <button
                  type="button"
                  onClick={applyCustom}
                  disabled={(() => {
                    const parsed = parseInt(customMinutes, 10);
                    return Number.isNaN(parsed) || parsed < 5 || parsed > 1440;
                  })()}
                  className="px-3 py-2 text-xs font-bold rounded-xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Apply
                </button>
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

            <div className="space-y-2">
              {/* Header and rows share the same sm: grid template so columns line up. */}
              <div className="hidden sm:grid sm:grid-cols-[24px_minmax(0,1.45fr)_132px_104px_minmax(0,1fr)_84px] sm:gap-3 sm:px-3 text-[10px] uppercase font-bold tracking-wide text-slate-400">
                <span>#</span>
                <span>Day *</span>
                <span>Start *</span>
                <span>Ends</span>
                <span>Label</span>
                <span />
              </div>
              {days.map((day, index) => {
                const end = endFor(day.startTime);
                return (
                  <div
                    key={day.id}
                    className="flex items-center gap-2 p-2 bg-slate-50/70 rounded-xl border border-slate-200/80 transition-all hover:border-slate-300 sm:grid sm:grid-cols-[24px_minmax(0,1.45fr)_132px_104px_minmax(0,1fr)_84px] sm:gap-3 sm:px-3 sm:py-2.5"
                  >
                    <input type="hidden" name="slotDate" value={day.date} />
                    <input type="hidden" name="slotStartTime" value={isAllDay ? "" : day.startTime} />
                    <input type="hidden" name="slotEndTime" value={isAllDay ? "" : end} />
                    <span
                      aria-hidden="true"
                      className="w-6 h-6 shrink-0 rounded-full bg-white border border-slate-200 text-[11px] font-bold text-slate-500 flex items-center justify-center"
                    >
                      {index + 1}
                    </span>

                    {/* On sm+ this wrapper disappears (contents) so Day/Start/Ends/Label
                        become direct grid items aligned with the header above. */}
                    <div className="flex-1 min-w-0 grid grid-cols-2 gap-2 sm:contents">
                      <span className="sr-only">Option {index + 1}</span>
                      <DatePicker
                        value={day.date}
                        onChange={(iso) => updateDay(day.id, { date: iso })}
                        accent="green"
                        className="col-span-2 sm:col-span-1 min-w-0"
                      />

                      {!isAllDay && (
                        <TimePicker
                          value={day.startTime}
                          onChange={(startTime) => updateDay(day.id, { startTime })}
                          accent="green"
                          className="min-w-0"
                        />
                      )}

                      {!isAllDay && (
                        <span
                          title={end ? `Ends ${formatTimeDisplay(end)}` : "End time"}
                          className="flex items-center h-10 text-xs font-semibold text-slate-500 whitespace-nowrap tabular-nums truncate min-w-0"
                        >
                          → {end ? formatTimeDisplay(end) : "—"}
                        </span>
                      )}

                      <input
                        type="text"
                        name="slotTitle"
                        placeholder="Label (optional)"
                        aria-label={`Label for option ${index + 1} (optional)`}
                        value={day.label}
                        onChange={(e) => updateDay(day.id, { label: e.target.value })}
                        className={`col-span-2 w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 placeholder:text-slate-400 min-w-0 ${isAllDay ? "sm:col-span-3" : "sm:col-span-1"}`}
                      />
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-0.5 sm:w-[84px]">
                      {!isAllDay && (
                        <button
                          type="button"
                          onClick={() => addHourAfter(day.id)}
                          title={`Add the next ${formatDurationLabel(durationMinutes)} block on the same day`}
                          className="px-1.5 py-1.5 text-green-700 hover:text-green-800 hover:bg-green-50 rounded-lg font-bold text-[11px] transition-colors whitespace-nowrap"
                        >
                          +{formatDurationLabel(durationMinutes).replace(/\s+/g, "")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeDay(day.id)}
                        disabled={days.length <= 1}
                        title="Remove this option"
                        aria-label={`Remove option ${index + 1}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-20 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 space-y-3">
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3">
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
          {turnstileSiteKey && (
            <div className="flex justify-end [&:empty]:hidden [&:has(.cf-turnstile:empty)]:hidden">
              <Turnstile siteKey={turnstileSiteKey} action="create-poll" resetKey={navigation.state} theme="light" size="compact" />
            </div>
          )}
        </div>
      </Form>
    </div>
  );
}
