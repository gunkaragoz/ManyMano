import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useSearchParams, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { getDb, events, eventSlots } from "~/db";
import { sendEmail } from "~/utils/email";

export async function loader({ request }: LoaderFunctionArgs) {
  return json({});
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as { DB: D1Database; RESEND_API_KEY?: string };
  const db = getDb(env.DB);
  const formData = await request.formData();

  const type = (formData.get("type") as string) || "SIGNUP_SHEET";
  const title = (formData.get("title") as string)?.trim();
  const eventDate = (formData.get("eventDate") as string)?.trim() || null;
  const description = (formData.get("description") as string)?.trim() || null;
  const location = (formData.get("location") as string)?.trim() || null;
  const organizerName = (formData.get("organizerName") as string)?.trim();
  const organizerEmail = (formData.get("organizerEmail") as string)?.trim();
  const timezone = (formData.get("timezone") as string)?.trim() || "UTC";

  // Validation
  if (!title) {
    return json({ error: "Please enter an event title." }, { status: 400 });
  }
  if (!organizerName) {
    return json({ error: "Please enter your organizer name." }, { status: 400 });
  }
  if (!organizerEmail || !organizerEmail.includes("@")) {
    return json({ error: "A valid email is required to receive your secret management link." }, { status: 400 });
  }

  // Parse slots
  const slotTitles = formData.getAll("slotTitle") as string[];
  const slotCapacities = formData.getAll("slotCapacity") as string[];
  const slotStartTimes = formData.getAll("slotStartTime") as string[];
  const slotEndTimes = formData.getAll("slotEndTime") as string[];

  const validSlots = slotTitles
    .map((t, idx) => {
      const startTime = slotStartTimes[idx]?.trim() || null;
      const endTime = slotEndTimes[idx]?.trim() || null;
      let title = t.trim();
      if (!title && startTime) {
        title = endTime ? `${startTime} – ${endTime}` : startTime;
      }
      return {
        title,
        capacity: parseInt(slotCapacities[idx] || "1", 10) || 1,
        startTime,
        endTime,
        displayOrder: idx,
      };
    })
    .filter((s) => s.title.length > 0);

  if (validSlots.length === 0) {
    return json({ error: "Please add at least one time slot or role." }, { status: 400 });
  }

  const eventId = crypto.randomUUID();
  const adminToken = crypto.randomUUID();
  const now = new Date().toISOString();

  // Insert into D1
  await db.insert(events).values({
    id: eventId,
    type,
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
      id: crypto.randomUUID(),
      eventId,
      title: slot.title,
      capacity: slot.capacity,
      startTime: slot.startTime,
      endTime: slot.endTime,
      displayOrder: slot.displayOrder,
    });
  }

  // Compose management links
  const url = new URL(request.url);
  const adminUrl = `${url.origin}/events/${eventId}?admin=${adminToken}`;
  const publicUrl = `${url.origin}/events/${eventId}`;

  // Send email to organizer (if Resend configured)
  await sendEmail({
    apiKey: env.RESEND_API_KEY,
    to: organizerEmail,
    subject: `Your ManyMano event: "${title}" is ready!`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 0;">Your event "${title}" is ready! 🎉</h2>
        <p>Hi ${organizerName},</p>
        <p>Your event has been created. Here are your links:</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 18px; border-radius: 12px; margin: 20px 0;">
          <p style="margin: 0 0 12px 0;"><strong>Public Link for Attendees:</strong><br><a href="${publicUrl}" style="color: #2563eb;">${publicUrl}</a></p>
          <p style="margin: 0;"><strong>Secret Management Link (Keep Private!):</strong><br><a href="${adminUrl}" style="color: #2563eb;">${adminUrl}</a></p>
        </div>
        ${eventDate ? `<p><strong>Date:</strong> ${eventDate}</p>` : ""}
        <p style="font-size: 13px; color: #64748b;">Bookmark your secret management link to view RSVPs, download CSV spreadsheets, and manage your event anytime.</p>
        <p style="margin-top: 24px; font-weight: 600;">— ManyMano</p>
      </div>
    `,
  });

  return redirect(`/events/${eventId}?admin=${adminToken}&created=1`);
}

export default function CreateEvent() {
  const [searchParams] = useSearchParams();
  const defaultType = searchParams.get("type") === "TIME_POLL" ? "TIME_POLL" : "SIGNUP_SHEET";
  const [eventType, setEventType] = useState<"SIGNUP_SHEET" | "TIME_POLL">(defaultType);
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Today's date formatted for default input
  const todayStr = new Date().toISOString().split("T")[0];

  // Initial time slots
  const [slots, setSlots] = useState<Array<{
    id: number;
    title: string;
    startTime: string;
    endTime: string;
    capacity: number;
  }>>([
    {
      id: 1,
      title: defaultType === "SIGNUP_SHEET" ? "Morning Welcome & Check-in" : "Morning Slot",
      startTime: "09:00",
      endTime: "11:00",
      capacity: defaultType === "SIGNUP_SHEET" ? 2 : 999,
    },
    {
      id: 2,
      title: defaultType === "SIGNUP_SHEET" ? "Snack & Drink Table" : "Afternoon Slot",
      startTime: "13:00",
      endTime: "15:00",
      capacity: defaultType === "SIGNUP_SHEET" ? 3 : 999,
    },
  ]);

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      {
        id: Date.now(),
        title: "",
        startTime: "",
        endTime: "",
        capacity: eventType === "SIGNUP_SHEET" ? 1 : 999,
      },
    ]);
  };

  const removeSlot = (id: number) => {
    if (slots.length <= 1) return;
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-10 py-4">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Create a New Event</h1>
        <p className="text-sm text-slate-500">
          Takes less than a minute. No password or registration required.
        </p>
      </div>

      {actionData?.error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-800 text-sm font-medium flex items-center gap-2">
          <span>⚠️</span>
          <span>{actionData.error}</span>
        </div>
      )}

      <Form method="post" className="bg-white border border-slate-200/80 rounded-3xl p-8 sm:p-10 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-10">
        {/* Step 1: Type Switcher */}
        <div className="space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            Step 1 • What are you coordinating?
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label
              className={`cursor-pointer rounded-2xl p-5 border-2 transition-all flex flex-col justify-between space-y-3 ${
                eventType === "SIGNUP_SHEET"
                  ? "border-blue-600 bg-blue-50/40 shadow-sm"
                  : "border-slate-200 hover:border-slate-300 bg-white"
              }`}
            >
              <input
                type="radio"
                name="type"
                value="SIGNUP_SHEET"
                checked={eventType === "SIGNUP_SHEET"}
                onChange={() => {
                  setEventType("SIGNUP_SHEET");
                  setSlots([
                    { id: 1, title: "Morning Welcome & Check-in", startTime: "09:00", endTime: "11:00", capacity: 2 },
                    { id: 2, title: "Snack & Drink Table", startTime: "11:00", endTime: "13:00", capacity: 3 },
                  ]);
                }}
                className="sr-only"
              />
              <div className="flex items-center justify-between">
                <span className="text-2xl">📋</span>
                {eventType === "SIGNUP_SHEET" && (
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">✓</span>
                )}
              </div>
              <div className="space-y-1">
                <div className="font-bold text-slate-900 text-base">Volunteer Sign-Up Sheet</div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Roles, shifts, food items, or equipment with specific slot limits.
                </p>
              </div>
            </label>

            <label
              className={`cursor-pointer rounded-2xl p-5 border-2 transition-all flex flex-col justify-between space-y-3 ${
                eventType === "TIME_POLL"
                  ? "border-blue-600 bg-blue-50/40 shadow-sm"
                  : "border-slate-200 hover:border-slate-300 bg-white"
              }`}
            >
              <input
                type="radio"
                name="type"
                value="TIME_POLL"
                checked={eventType === "TIME_POLL"}
                onChange={() => {
                  setEventType("TIME_POLL");
                  setSlots([
                    { id: 1, title: "Morning Slot", startTime: "10:00", endTime: "11:00", capacity: 999 },
                    { id: 2, title: "Afternoon Slot", startTime: "14:00", endTime: "15:00", capacity: 999 },
                  ]);
                }}
                className="sr-only"
              />
              <div className="flex items-center justify-between">
                <span className="text-2xl">📅</span>
                {eventType === "TIME_POLL" && (
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">✓</span>
                )}
              </div>
              <div className="space-y-1">
                <div className="font-bold text-slate-900 text-base">Meeting Time Finder</div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Classic Doodle availability matrix to vote on dates & times.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Step 2: Event Details (Includes Event Date) */}
        <div className="space-y-5 pt-2 border-t border-slate-100">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            Step 2 • Event Details
          </label>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Event Title *
              </label>
              <input
                type="text"
                name="title"
                required
                placeholder={
                  eventType === "SIGNUP_SHEET"
                    ? "e.g., Spring Community Garden Cleanup"
                    : "e.g., Q4 Product Roadmap Planning"
                }
                className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
              />
            </div>

            {/* Event Date & Location Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Event Date *
                </label>
                <input
                  type="date"
                  name="eventDate"
                  required
                  defaultValue={todayStr}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Location or Meeting Link (Optional)
                </label>
                <input
                  type="text"
                  name="location"
                  placeholder="e.g., Park North Gate or https://meet.google.com/xyz"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Description / Notes (Optional)
              </label>
              <textarea
                name="description"
                rows={3}
                placeholder="Share any background details, instructions, or meeting agenda..."
                className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400 leading-relaxed"
              />
            </div>

            {/* Organizer Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Your Name *
                </label>
                <input
                  type="text"
                  name="organizerName"
                  required
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
                  placeholder="sarah@example.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200/90 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  We'll email your secret link to manage this event anytime.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3: Time Slots */}
        <div className="space-y-4 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                Step 3 • Time Slots
              </label>
              <p className="text-xs text-slate-500 mt-0.5">
                {eventType === "SIGNUP_SHEET"
                  ? "Define the shifts or time slots for the event date and how many volunteers are needed."
                  : "Specify the candidate time windows for attendees to vote on."}
              </p>
            </div>

            <button
              type="button"
              onClick={addSlot}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 hover:border-blue-400 hover:text-blue-600 bg-white transition-all shadow-sm flex items-center gap-1 shrink-0"
            >
              <span>+ Add Time Slot</span>
            </button>
          </div>

          <div className="space-y-3.5">
            {slots.map((slot, index) => (
              <div
                key={slot.id}
                className="p-4 bg-slate-50/70 rounded-2xl border border-slate-200/80 transition-all space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">
                    Slot {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSlot(slot.id)}
                    disabled={slots.length <= 1}
                    className="text-slate-400 hover:text-rose-500 font-bold text-xs disabled:opacity-20 transition-colors"
                  >
                    Remove ✕
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  {/* Start and End Times */}
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                      Start Time
                    </label>
                    <input
                      type="time"
                      name="slotStartTime"
                      defaultValue={slot.startTime}
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
                      defaultValue={slot.endTime}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>

                  {/* Title or Role description */}
                  <div className={eventType === "SIGNUP_SHEET" ? "sm:col-span-4" : "sm:col-span-6"}>
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                      {eventType === "SIGNUP_SHEET" ? "Role or Item Name" : "Label / Description"}
                    </label>
                    <input
                      type="text"
                      name="slotTitle"
                      required
                      placeholder={
                        eventType === "SIGNUP_SHEET"
                          ? "e.g., Morning Setup Crew"
                          : "e.g., Morning Strategy Session"
                      }
                      defaultValue={slot.title}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>

                  {/* Capacity for volunteers */}
                  {eventType === "SIGNUP_SHEET" && (
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                        Spots
                      </label>
                      <input
                        type="number"
                        name="slotCapacity"
                        min="1"
                        max="999"
                        defaultValue={slot.capacity}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>
                  )}

                  {eventType === "TIME_POLL" && (
                    <input type="hidden" name="slotCapacity" value="999" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Creating Event...</span>
              </>
            ) : (
              <span>Create Event & Get Links →</span>
            )}
          </button>
        </div>
      </Form>
    </div>
  );
}
