import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation, Link } from "@remix-run/react";
import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, TriangleAlert, X } from "lucide-react";
import { usePersistentState } from "~/utils/usePersistentState";
import { getDb, events, eventSlots } from "~/db";
import { eq } from "drizzle-orm";
import {
  generateInternalId,
  generateSecretToken,
  generateUniquePublicId,
} from "~/utils/ids";
import { sendEmail } from "~/utils/email";

export async function loader({ request }: LoaderFunctionArgs) {
  return json({});
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as { DB: D1Database; RESEND_API_KEY?: string };
  const db = getDb(env.DB);
  const formData = await request.formData();

  const title = (formData.get("title") as string)?.trim();
  const eventDate = (formData.get("eventDate") as string)?.trim() || null;
  const description = (formData.get("description") as string)?.trim() || null;
  const location = (formData.get("location") as string)?.trim() || null;
  const organizerName = (formData.get("organizerName") as string)?.trim();
  const organizerEmail = (formData.get("organizerEmail") as string)?.trim();
  const timezone = (formData.get("timezone") as string)?.trim() || "UTC";

  // Validation
  if (!title) {
    return json({ error: "Please enter a meeting title." }, { status: 400 });
  }
  if (!organizerName) {
    return json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!organizerEmail || !organizerEmail.includes("@")) {
    return json({ error: "A valid email is required to receive your secret management link." }, { status: 400 });
  }

  // Parse time options
  const slotTitles = formData.getAll("slotTitle") as string[];
  const slotStartTimes = formData.getAll("slotStartTime") as string[];
  const slotEndTimes = formData.getAll("slotEndTime") as string[];

  const validSlots = slotTitles
    .map((t, idx) => {
      const startTime = slotStartTimes[idx]?.trim() || null;
      const endTime = slotEndTimes[idx]?.trim() || null;
      let slotTitle = t.trim();
      if (!slotTitle && startTime) {
        slotTitle = endTime ? `${startTime} – ${endTime}` : startTime;
      }
      return {
        title: slotTitle,
        capacity: 999, // unlimited voters
        startTime,
        endTime,
        displayOrder: idx,
      };
    })
    .filter((s) => s.title.length > 0);

  if (validSlots.length === 0) {
    return json({ error: "Please add at least one candidate time slot." }, { status: 400 });
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
  const now = new Date().toISOString();

  // Insert into D1
  await db.insert(events).values({
    id: eventId,
    type: "TIME_POLL",
    title,
    eventDate,
    description,
    location,
    organizerName,
    organizerEmail,
    adminToken,
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
      capacity: slot.capacity,
      startTime: slot.startTime,
      endTime: slot.endTime,
      displayOrder: slot.displayOrder,
    });
  }

  const url = new URL(request.url);
  const adminUrl = `${url.origin}/events/${eventId}?admin=${adminToken}`;
  const publicUrl = `${url.origin}/events/${eventId}`;

  await sendEmail({
    apiKey: env.RESEND_API_KEY,
    to: organizerEmail,
    subject: `Your meeting poll: "${title}" is live!`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 0;">Your meeting poll "${title}" is ready!</h2>
        <p>Hi ${organizerName},</p>
        <p>Here are your links:</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 18px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 0 0 12px 0;"><strong>Share with Attendees to Vote:</strong><br><a href="${publicUrl}" style="color: #2563eb;">${publicUrl}</a></p>
          <p style="margin: 0;"><strong>Secret Management Link (Keep Private!):</strong><br><a href="${adminUrl}" style="color: #2563eb;">${adminUrl}</a></p>
        </div>
        ${eventDate ? `<p><strong>Proposed Date:</strong> ${eventDate}</p>` : ""}
        <p style="font-size: 13px; color: #64748b;">Use your secret management link to see live vote tallies, lock the winning time, and generate calendar invites.</p>
        <p style="margin-top: 24px; font-weight: 600;">— ManyMano</p>
      </div>
    `,
  });

  return redirect(`/events/${eventId}?admin=${adminToken}&created=1`);
}

type PollDetails = {
  title: string;
  eventDate: string;
  description: string;
  location: string;
  organizerName: string;
  organizerEmail: string;
};

type TimeSlot = {
  id: number;
  title: string;
  startTime: string;
  endTime: string;
};

const POLL_DETAILS_KEY = "manymano:create-poll:details:v1";
const POLL_SLOTS_KEY = "manymano:create-poll:slots:v1";

const defaultPollSlots: TimeSlot[] = [
  { id: 1, title: "Morning Window", startTime: "10:00", endTime: "11:00" },
  { id: 2, title: "Afternoon Window", startTime: "14:00", endTime: "15:00" },
  { id: 3, title: "Late Afternoon Window", startTime: "16:00", endTime: "17:00" },
];

export default function CreateMeetingPoll() {
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const todayStr = new Date().toISOString().split("T")[0];

  // Draft persists across refresh (same tab) via sessionStorage.
  // Cleared on successful create so the next "Create Event" starts clean.
  const [details, setDetails, clearDetails] = usePersistentState<PollDetails>(
    POLL_DETAILS_KEY,
    () => ({
      title: "",
      eventDate: new Date().toISOString().split("T")[0],
      description: "",
      location: "",
      organizerName: "",
      organizerEmail: "",
    })
  );
  const [timeSlots, setTimeSlots, clearSlots] = usePersistentState<TimeSlot[]>(
    POLL_SLOTS_KEY,
    defaultPollSlots
  );

  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (navigation.state === "submitting") {
      wasSubmitting.current = true;
    } else if (navigation.state === "loading" && wasSubmitting.current) {
      // Form POST succeeded and we're redirecting to the new event.
      wasSubmitting.current = false;
      clearDetails();
      clearSlots();
    } else if (navigation.state === "idle") {
      // Validation error returns to idle without redirect -> keep draft.
      wasSubmitting.current = false;
    }
  }, [navigation.state, clearDetails, clearSlots]);

  const updateDetails = (patch: Partial<PollDetails>) =>
    setDetails((prev) => ({ ...prev, ...patch }));

  const startOver = () => {
    clearDetails();
    clearSlots();
    // Reset date to today (clear() restores the first-render initial).
    setDetails((prev) => ({ ...prev, eventDate: todayStr }));
    setTimeSlots(defaultPollSlots);
  };

  const addTimeSlot = () => {
    setTimeSlots((prev) => [
      ...prev,
      {
        id: Date.now(),
        title: "",
        startTime: "",
        endTime: "",
      },
    ]);
  };

  const removeTimeSlot = (id: number) => {
    if (timeSlots.length <= 1) return;
    setTimeSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const updateTimeSlot = (id: number, patch: Partial<Omit<TimeSlot, "id">>) => {
    setTimeSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-4">
      {/* Header & Back Link */}
      <div className="space-y-2">
        <Link to="/" className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Home</span>
        </Link>
        <div className="flex items-center gap-3 pt-1">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Create Meeting Time Poll
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Simple consensus grid. Propose time slots and let attendees vote on their availability.
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
        {/* Step 1: Meeting Details */}
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              Step 1 • Meeting Details
            </label>
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
                  Target Date *
                </label>
                <input
                  type="date"
                  name="eventDate"
                  required
                  value={details.eventDate || todayStr}
                  onChange={(e) => updateDetails({ eventDate: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-800"
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
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                />
              </div>
            </div>

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

        {/* Step 2: Proposed Time Windows */}
        <div className="space-y-4 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Step 2 • Proposed Time Slots
              </label>
              <p className="text-xs text-slate-500 mt-0.5">
                Add candidate time windows for participants to vote Yes / (If need be) / No.
              </p>
            </div>

            <button
              type="button"
              onClick={addTimeSlot}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-2xl border border-slate-200 hover:border-blue-400 hover:text-blue-600 bg-white transition-all shadow-sm flex items-center gap-1 shrink-0"
            >
              <span>+ Add Time Slot</span>
            </button>
          </div>

          <div className="space-y-3.5">
            {timeSlots.map((slot, index) => (
              <div
                key={slot.id}
                className="p-4 bg-slate-50/70 rounded-2xl border border-slate-200/80 transition-all space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">
                    Option {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeTimeSlot(slot.id)}
                    disabled={timeSlots.length <= 1}
                    className="text-slate-400 hover:text-rose-500 font-bold text-xs disabled:opacity-20 transition-colors inline-flex items-center gap-1"
                  >
                    Remove <X className="w-3 h-3" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                      Start Time
                    </label>
                    <input
                      type="time"
                      name="slotStartTime"
                      value={slot.startTime}
                      onChange={(e) => updateTimeSlot(slot.id, { startTime: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                      End Time
                    </label>
                    <input
                      type="time"
                      name="slotEndTime"
                      value={slot.endTime}
                      onChange={(e) => updateTimeSlot(slot.id, { endTime: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-6">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                      Option Label (Optional)
                    </label>
                    <input
                      type="text"
                      name="slotTitle"
                      placeholder="e.g., Morning Slot"
                      value={slot.title}
                      onChange={(e) => updateTimeSlot(slot.id, { title: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
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
            className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
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
