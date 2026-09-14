import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useLoaderData, useNavigation, Link } from "@remix-run/react";
import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, ClipboardList, TriangleAlert, X } from "lucide-react";
import { usePersistentState } from "~/utils/usePersistentState";
import DatePicker from "~/components/DatePicker";
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
import { sendEmail, emailFooter } from "~/utils/email";
import { formatLongDateLabel } from "~/utils/calendar";
import { escapeHtml } from "~/utils/sanitize";
import { buildAdminCookie, hashSecretForStorage } from "~/utils/auth";
import {
  COMMENT_MAX,
  DESCRIPTION_MAX,
  EMAIL_MAX,
  LOCATION_MAX,
  MAX_SLOTS_PER_EVENT,
  ORGANIZER_NAME_MAX,
  SHIFT_NAME_MAX,
  SLOT_TITLE_MAX,
  TITLE_MAX,
  cleanText,
  isValidEmail,
  isValidIsoDate,
  isValidTime,
  parseTimezoneInput,
  timeToMinutes,
} from "~/utils/validation";
import { pruneExpiredEvents } from "~/utils/retention";
import { getSiteConfig } from "~/utils/site";
import { verifyTurnstile, turnstileFailure } from "~/utils/turnstile";
import Turnstile from "~/components/Turnstile";
import {
  getPageMeta,
  breadcrumbJsonLd,
  mergeParentMeta,
  pageMetaOverrides,
  rootSiteFromMatches,
} from "~/utils/seo";

export const meta: MetaFunction = ({ matches }) => {
  const site = rootSiteFromMatches(matches);
  const page = getPageMeta(site.siteName).createSignup;
  return mergeParentMeta(matches, [
    ...pageMetaOverrides({ ...page, siteUrl: site.siteUrl }),
    {
      "script:ld+json": breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Create", path: "/create" },
        { name: "Sign-Up Sheet", path: "/create/signup" },
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

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as {
    DB: D1Database;
    RESEND_API_KEY?: string;
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
  const eventDate = cleanText(formData.get("eventDate"), 32) || null;
  const description = cleanText(formData.get("description"), DESCRIPTION_MAX) || null;
  const location = cleanText(formData.get("location"), LOCATION_MAX) || null;
  const organizerName = cleanText(formData.get("organizerName"), ORGANIZER_NAME_MAX);
  const organizerEmail = cleanText(formData.get("organizerEmail"), EMAIL_MAX);
  const timezone = parseTimezoneInput(formData.get("timezone") as string);

  // Validation
  if (!title) {
    return json({ error: "Please enter an event title." }, { status: 400 });
  }
  if (eventDate && !isValidIsoDate(eventDate)) {
    return json({ error: "Please pick a valid event date." }, { status: 400 });
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
    expectedAction: "create-signup",
    env,
    remoteIp: request.headers.get("cf-connecting-ip"),
  });
  if (!turnstile.ok) {
    const f = turnstileFailure();
    return json(f.body, { status: f.status });
  }

  // Parse shifts / tasks.
  // Each task posts one entry of each array; shift-level fields are
  // duplicated per task via hidden inputs so indices stay aligned.
  const slotTitles = formData.getAll("slotTitle") as string[];
  const slotCapacities = formData.getAll("slotCapacity") as string[];
  const slotStartTimes = formData.getAll("slotStartTime") as string[];
  const slotEndTimes = formData.getAll("slotEndTime") as string[];
  const slotShiftNames = formData.getAll("slotShiftName") as string[];

  const validSlots = slotTitles
    .map((t, idx) => {
      const startTime = cleanText(slotStartTimes[idx], 16) || null;
      const endTime = cleanText(slotEndTimes[idx], 16) || null;
      const shiftName = cleanText(slotShiftNames[idx], SHIFT_NAME_MAX) || null;
      let slotTitle = cleanText(t, SLOT_TITLE_MAX);
      if (!slotTitle && (startTime || shiftName)) {
        slotTitle = (shiftName || (endTime ? `${startTime} – ${endTime}` : (startTime as string))).slice(
          0,
          SLOT_TITLE_MAX
        );
      }
      const rawCap = parseInt(slotCapacities[idx] || "1", 10);
      const capacity = Number.isFinite(rawCap) ? Math.min(Math.max(rawCap, 1), 999) : 1;
      return {
        title: slotTitle,
        shiftName,
        capacity,
        startTime,
        endTime,
        displayOrder: idx,
      };
    })
    .filter((s) => s.title.length > 0)
    .slice(0, MAX_SLOTS_PER_EVENT);

  if (validSlots.length === 0) {
    return json({ error: "Please add at least one task." }, { status: 400 });
  }
  for (const s of validSlots) {
    if ((s.startTime && !isValidTime(s.startTime)) || (s.endTime && !isValidTime(s.endTime))) {
      return json({ error: `"${s.title}": please pick a valid time.` }, { status: 400 });
    }
    if (s.startTime && s.endTime && timeToMinutes(s.endTime) <= timeToMinutes(s.startTime)) {
      return json(
        { error: `"${s.title}": end time must be after the start time.` },
        { status: 400 }
      );
    }
  }
  if (slotTitles.length > MAX_SLOTS_PER_EVENT) {
    return json(
      { error: `Too many tasks — maximum ${MAX_SLOTS_PER_EVENT} per event.` },
      { status: 400 }
    );
  }

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

  // Insert into D1
  await db.insert(events).values({
    id: eventId,
    type: "SIGNUP_SHEET",
    title,
    eventDate,
    description,
    location,
    organizerName,
    organizerEmail,
    adminToken: adminTokenStored,
    status: "OPEN",
    settings: JSON.stringify({}),
    timezone,
    createdAt: now,
    updatedAt: now,
  });

  for (const slot of validSlots) {
    await db.insert(eventSlots).values({
      id: generateInternalId(),
      eventId,
      title: slot.title,
      shiftName: slot.shiftName,
      capacity: slot.capacity,
      startTime: slot.startTime,
      endTime: slot.endTime,
      displayOrder: slot.displayOrder,
    });
  }

  const url = new URL(request.url);
  const adminUrl = `${url.origin}/events/${eventId}?admin=${adminToken}`;
  const publicUrl = `${url.origin}/events/${eventId}`;
  // Auto-generated QR code (PNG) encoding the public link — organizers can
  // print it on flyers or show it at the door; scanning opens the event page.
  const qrUrl = `${publicUrl}/qr?format=png`;

  await sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: site.fromEmail,
    to: organizerEmail,
    subject: `Your sign-up sheet: "${title}" is ready!`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 0;">Your sign-up sheet "${escapeHtml(title)}" is ready!</h2>
        <p>Hi ${escapeHtml(organizerName)},</p>
        <p>Here are your links:</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 18px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 0 0 12px 0;"><strong>Public Link for Participants:</strong><br><a href="${escapeHtml(publicUrl)}" style="color: #2563eb;">${escapeHtml(publicUrl)}</a></p>
          <p style="margin: 0;"><strong>Secret Management Link (Keep Private!):</strong><br><a href="${escapeHtml(adminUrl)}" style="color: #2563eb;">${escapeHtml(adminUrl)}</a></p>
        </div>
        <div style="text-align: center; margin: 20px 0;">
          <p style="margin: 0 0 8px 0;"><strong>QR code for your event page:</strong></p>
          <a href="${escapeHtml(publicUrl)}"><img src="${escapeHtml(qrUrl)}" alt="QR code linking to your event page" width="180" height="180" style="width: 180px; height: 180px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 6px; background: #ffffff;" /></a>
          <p style="margin: 8px 0 0 0; font-size: 13px; color: #64748b;">Scan to open the event page — print it on flyers or show it at the door.</p>
        </div>
        ${eventDate ? `<p><strong>Date:</strong> ${escapeHtml(formatLongDateLabel(eventDate))}</p>` : ""}
        ${description ? `<p><strong>Description:</strong><br>${escapeHtml(description).replace(/\r?\n/g, "<br>")}</p>` : ""}
        <p style="font-size: 13px; color: #64748b;">Use the secret management link to view RSVPs, download CSV spreadsheets, and manage sign-ups. You can delete it anytime from Organizer Admin Mode.</p>
        ${emailFooter(site)}
      </div>
    `,
  });

  const headers = new Headers();
  headers.append("Set-Cookie", buildAdminCookie(eventId, adminToken));
  return redirect(`/events/${eventId}?admin=${adminToken}&created=1`, { headers });
}

type SignupDetails = {
  title: string;
  eventDate: string;
  description: string;
  location: string;
  organizerName: string;
  organizerEmail: string;
  timezone: string;
};

type Shift = {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  tasks: Array<{ id: number; title: string; capacity: number }>;
};

const SIGNUP_DETAILS_KEY = "manymano:create-signup:details:v2";
const SIGNUP_SHIFTS_KEY = "manymano:create-signup:shifts:v1";

const defaultSignupShifts: Shift[] = [
  {
    id: 1,
    name: "Morning",
    startTime: "08:30",
    endTime: "10:30",
    tasks: [{ id: 11, title: "Setup & Check-in", capacity: 2 }],
  },
  {
    id: 2,
    name: "Midday",
    startTime: "10:30",
    endTime: "12:30",
    tasks: [{ id: 21, title: "Refreshments & Snacks", capacity: 3 }],
  },
];

export default function CreateSignupSheet() {
  const actionData = useActionData<{ error?: string }>();
  const { turnstileSiteKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const todayStr = new Date().toISOString().split("T")[0];

  // Draft persists across refresh (same tab) via sessionStorage.
  // Cleared on successful create so the next "Create Event" starts clean.
  const [details, setDetails, clearDetails] = usePersistentState<SignupDetails>(
    SIGNUP_DETAILS_KEY,
    () => ({
      title: "",
      eventDate: new Date().toISOString().split("T")[0],
      description: "",
      location: "",
      organizerName: "",
      organizerEmail: "",
      timezone: "UTC",
    })
  );
  const [shifts, setShifts, clearShifts] = usePersistentState<Shift[]>(
    SIGNUP_SHIFTS_KEY,
    defaultSignupShifts
  );

  const wasSubmitting = useRef(false);
  const titleSentinelRef = useRef<HTMLDivElement>(null);
  useCreateStickyHeader(details.title, details.eventDate, titleSentinelRef);

  // Auto-detect browser timezone once (client only, never clobbers a saved draft).
  useEffect(() => {
    const detected = detectLocalTimezone();
    if (detected && (details.timezone === "UTC" || !details.timezone)) {
      setDetails((prev) =>
        prev.timezone === "UTC" || !prev.timezone ? { ...prev, timezone: detected } : prev
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (navigation.state === "submitting") {
      wasSubmitting.current = true;
    } else if (navigation.state === "loading" && wasSubmitting.current) {
      // Form POST succeeded and we're redirecting to the new event.
      wasSubmitting.current = false;
      clearDetails();
      clearShifts();
    } else if (navigation.state === "idle") {
      // Validation error returns to idle without redirect -> keep draft.
      wasSubmitting.current = false;
    }
  }, [navigation.state, clearDetails, clearShifts]);

  const updateDetails = (patch: Partial<SignupDetails>) =>
    setDetails((prev) => ({ ...prev, ...patch }));

  const startOver = () => {
    clearDetails();
    clearShifts();
    setDetails((prev) => ({ ...prev, eventDate: todayStr }));
    setShifts(defaultSignupShifts);
  };

  const addShift = () => {
    setShifts((prev) => [
      ...prev,
      {
        id: Date.now(),
        name: "",
        startTime: "",
        endTime: "",
        tasks: [{ id: Date.now() + 1, title: "", capacity: 1 }],
      },
    ]);
  };

  const removeShift = (id: number) => {
    if (shifts.length <= 1) return;
    setShifts((prev) => prev.filter((s) => s.id !== id));
  };

  const updateShift = (id: number, patch: Partial<{ name: string; startTime: string; endTime: string }>) => {
    setShifts((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addTask = (shiftId: number) => {
    setShifts((prev) =>
      prev.map((s) =>
        s.id === shiftId
          ? { ...s, tasks: [...s.tasks, { id: Date.now(), title: "", capacity: 1 }] }
          : s
      )
    );
  };

  const removeTask = (shiftId: number, taskId: number) => {
    setShifts((prev) =>
      prev.map((s) =>
        s.id === shiftId && s.tasks.length > 1
          ? { ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }
          : s
      )
    );
  };

  const updateTask = (
    shiftId: number,
    taskId: number,
    patch: Partial<{ title: string; capacity: number }>
  ) => {
    setShifts((prev) =>
      prev.map((s) =>
        s.id === shiftId
          ? { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) }
          : s
      )
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 py-4">
      {/* Header & Back Link */}
      <div className="space-y-2">
        <Link to="/" className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Home</span>
        </Link>
        <div className="flex items-center gap-3 pt-1">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Create Sign-Up Sheet
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Set up shifts with tasks and spots for your event. No registration or password required.
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
        <div className="relative pl-9 space-y-8">
          {/* Thin vertical line connecting steps */}
          <div aria-hidden="true" className="absolute left-3 top-3 bottom-3 w-px bg-blue-100" />
          {/* Step 1: Event Details */}
          <div className="relative space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="absolute -left-9 top-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0 ring-4 ring-white">
                1
              </span>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Event Details
              </label>
            </div>
            <span className="text-[11px] text-slate-400" title="Your draft is saved in this tab and survives refresh. It clears after successful creation.">
              Draft auto-saved in this tab
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Event Title *
              </label>
              <input
                type="text"
                name="title"
                required
                value={details.title}
                onChange={(e) => updateDetails({ title: e.target.value })}
                placeholder="e.g., Saturday Community Garden Clean Up"
                className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Event Date *
                </label>
                <DatePicker
                  name="eventDate"
                  value={details.eventDate || todayStr}
                  onChange={(iso) => updateDetails({ eventDate: iso })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Location (Optional)
                </label>
                <input
                  type="text"
                  name="location"
                  value={details.location}
                  onChange={(e) => updateDetails({ location: e.target.value })}
                  placeholder="e.g., Meadow Creek Park (North Gate)"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                />
              </div>
            </div>

            <div>
              <label htmlFor="signup-timezone" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Timezone
              </label>
              <TimezoneSelect
                id="signup-timezone"
                name="timezone"
                value={details.timezone || "UTC"}
                onChange={(timezone) => updateDetails({ timezone })}
                accent="blue"
              />
            </div>

            {/* Sentinel: show title+date in nav header once Title/Date scrolled out of view */}
            <div ref={titleSentinelRef} aria-hidden="true" className="h-px w-full" />

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Description / Notes (Optional)
              </label>
              <textarea
                name="description"
                rows={3}
                value={details.description}
                onChange={(e) => updateDetails({ description: e.target.value })}
                placeholder="Details for participants, what to bring, parking notes, or instructions..."
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
                  placeholder="e.g., Sarah Chen"
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
                  placeholder="sarah@example.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  We'll email your private organizer link here.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Shifts & Tasks */}
        <div className="relative space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="absolute -left-9 top-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0 ring-4 ring-white">
                  2
                </span>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Shifts & Tasks
                </label>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Name each shift (optional), set its time, then add one or more tasks sharing that time.
              </p>
            </div>

            <button
              type="button"
              onClick={addShift}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-2xl border border-slate-200 hover:border-blue-400 hover:text-blue-600 bg-white transition-all shadow-sm flex items-center gap-1 shrink-0"
            >
              <span>+ Add Shift</span>
            </button>
          </div>

          <div className="space-y-3.5">
            {shifts.map((shift, index) => (
              <div
                key={shift.id}
                className="p-4 bg-slate-50/70 rounded-2xl border border-slate-200/80 transition-all space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">
                    Shift {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeShift(shift.id)}
                    disabled={shifts.length <= 1}
                    className="text-slate-400 hover:text-rose-500 font-bold text-xs disabled:opacity-20 transition-colors inline-flex items-center gap-1"
                  >
                    Remove <X className="w-3 h-3" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  <div className="sm:col-span-6">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                      Shift Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={shift.name}
                      onChange={(e) => updateShift(shift.id, { name: e.target.value })}
                      placeholder="e.g., Morning"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-slate-400"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={shift.startTime}
                      onChange={(e) => updateShift(shift.id, { startTime: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                      End Time
                    </label>
                    <input
                      type="time"
                      value={shift.endTime}
                      onChange={(e) => updateShift(shift.id, { endTime: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-2.5 pt-1">
                  {shift.tasks.map((task) => (
                    <div
                      key={task.id}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end bg-white rounded-xl border border-slate-200/80 p-3"
                    >
                      {/* Duplicated per task so server arrays stay aligned */}
                      <input type="hidden" name="slotShiftName" value={shift.name} />
                      <input type="hidden" name="slotStartTime" value={shift.startTime} />
                      <input type="hidden" name="slotEndTime" value={shift.endTime} />

                      <div className="sm:col-span-8">
                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                          Task *
                        </label>
                        <input
                          type="text"
                          name="slotTitle"
                          required
                          placeholder="e.g., Setup Crew"
                          value={task.title}
                          onChange={(e) => updateTask(shift.id, task.id, { title: e.target.value })}
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-slate-400"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                          Spots Needed
                        </label>
                        <input
                          type="number"
                          name="slotCapacity"
                          min="1"
                          max="999"
                          value={task.capacity}
                          onChange={(e) =>
                            updateTask(shift.id, task.id, {
                              capacity: parseInt(e.target.value, 10) || 1,
                            })
                          }
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                      </div>

                      <div className="sm:col-span-1 flex sm:justify-end">
                        <button
                          type="button"
                          onClick={() => removeTask(shift.id, task.id)}
                          disabled={shift.tasks.length <= 1}
                          title="Remove task"
                          className="text-slate-400 hover:text-rose-500 font-bold text-xs disabled:opacity-20 transition-colors inline-flex items-center gap-1 p-2"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => addTask(shift.id)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-2xl border border-dashed border-slate-300 hover:border-blue-400 hover:text-blue-600 bg-white transition-all flex items-center gap-1"
                  >
                    <span>+ Add Task to this shift</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        </div>

        {/* Submit */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
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
            className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Creating Sheet...</span>
              </>
            ) : (
              <span className="inline-flex items-center gap-2">Create Sign-Up Sheet & Get Links <ArrowRight className="w-4 h-4" /></span>
            )}
          </button>
          </div>
          {turnstileSiteKey && (
            <div className="flex justify-end [&:empty]:hidden [&:has(.cf-turnstile:empty)]:hidden">
              <Turnstile siteKey={turnstileSiteKey} action="create-signup" resetKey={navigation.state} theme="light" size="compact" />
            </div>
          )}
        </div>
      </Form>
    </div>
  );
}
