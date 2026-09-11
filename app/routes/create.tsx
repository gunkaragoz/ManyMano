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
  const description = (formData.get("description") as string)?.trim() || null;
  const location = (formData.get("location") as string)?.trim() || null;
  const organizerName = (formData.get("organizerName") as string)?.trim();
  const organizerEmail = (formData.get("organizerEmail") as string)?.trim();
  const timezone = (formData.get("timezone") as string)?.trim() || "UTC";

  // Validation
  if (!title) {
    return json({ error: "Event title is required." }, { status: 400 });
  }
  if (!organizerName) {
    return json({ error: "Organizer name is required." }, { status: 400 });
  }
  if (!organizerEmail || !organizerEmail.includes("@")) {
    return json({ error: "A valid organizer email is required to receive the secret management link." }, { status: 400 });
  }

  // Parse slots
  const slotTitles = formData.getAll("slotTitle") as string[];
  const slotCapacities = formData.getAll("slotCapacity") as string[];
  const slotStartTimes = formData.getAll("slotStartTime") as string[];
  const slotEndTimes = formData.getAll("slotEndTime") as string[];

  const validSlots = slotTitles
    .map((t, idx) => ({
      title: t.trim(),
      capacity: parseInt(slotCapacities[idx] || "1", 10) || 1,
      startTime: slotStartTimes[idx]?.trim() || null,
      endTime: slotEndTimes[idx]?.trim() || null,
      displayOrder: idx,
    }))
    .filter((s) => s.title.length > 0);

  if (validSlots.length === 0) {
    return json({ error: "Please add at least one slot or time option." }, { status: 400 });
  }

  const eventId = crypto.randomUUID();
  const adminToken = crypto.randomUUID();
  const now = new Date().toISOString();

  // Insert into D1
  await db.insert(events).values({
    id: eventId,
    type,
    title,
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

  // Compose management link
  const url = new URL(request.url);
  const adminUrl = `${url.origin}/events/${eventId}?admin=${adminToken}`;
  const publicUrl = `${url.origin}/events/${eventId}`;

  // Send email to organizer
  await sendEmail({
    apiKey: env.RESEND_API_KEY,
    to: organizerEmail,
    subject: `Your ManyMano event: "${title}" is ready!`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Your event "${title}" is live!</h2>
        <p>Hi ${organizerName},</p>
        <p>Your event has been created. Here are your links:</p>
        <div style="background: #f1f5f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Public Link for Participants:</strong><br><a href="${publicUrl}">${publicUrl}</a></p>
          <p><strong>Secret Admin Link (Keep Private!):</strong><br><a href="${adminUrl}">${adminUrl}</a></p>
        </div>
        <p>You can use the secret admin link anytime to view responses, export CSVs, or finalize times.</p>
        <p>— The ManyMano Team</p>
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

  // Initial slot templates depending on type
  const [slots, setSlots] = useState<Array<{ id: number; title: string; capacity: number; startTime: string; endTime: string }>>([
    { id: 1, title: defaultType === "SIGNUP_SHEET" ? "Morning Setup Crew" : "Wed Oct 14 @ 10:00 AM – 11:00 AM", capacity: defaultType === "SIGNUP_SHEET" ? 3 : 99, startTime: "", endTime: "" },
    { id: 2, title: defaultType === "SIGNUP_SHEET" ? "Afternoon Greeters" : "Thu Oct 15 @ 2:00 PM – 3:00 PM", capacity: defaultType === "SIGNUP_SHEET" ? 2 : 99, startTime: "", endTime: "" },
  ]);

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      {
        id: Date.now(),
        title: "",
        capacity: eventType === "SIGNUP_SHEET" ? 1 : 99,
        startTime: "",
        endTime: "",
      },
    ]);
  };

  const removeSlot = (id: number) => {
    if (slots.length <= 1) return;
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Create a New Event</h1>
        <p className="text-sm text-slate-600 mt-1">
          Completely free. No account or password needed. You will receive an instant secret link to manage your event.
        </p>
      </div>

      {actionData?.error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-medium">
          ⚠️ {actionData.error}
        </div>
      )}

      <Form method="post" className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        {/* Type Selection */}
        <div>
          <label className="block text-sm font-bold text-slate-900 mb-2">Select Event Type</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              className={`cursor-pointer rounded-xl p-4 border-2 transition-all flex flex-col justify-between ${
                eventType === "SIGNUP_SHEET"
                  ? "border-blue-600 bg-blue-50/50 shadow-sm"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="type"
                value="SIGNUP_SHEET"
                checked={eventType === "SIGNUP_SHEET"}
                onChange={() => setEventType("SIGNUP_SHEET")}
                className="sr-only"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span>📋 Volunteer Sign-Up Sheet</span>
                </div>
                <p className="text-xs text-slate-500">
                  Like SignUpGenius. Define tasks, roles, or potluck items with specific slot limits and sign-up requirements.
                </p>
              </div>
            </label>

            <label
              className={`cursor-pointer rounded-xl p-4 border-2 transition-all flex flex-col justify-between ${
                eventType === "TIME_POLL"
                  ? "border-blue-600 bg-blue-50/50 shadow-sm"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="type"
                value="TIME_POLL"
                checked={eventType === "TIME_POLL"}
                onChange={() => setEventType("TIME_POLL")}
                className="sr-only"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span>📅 Meeting Time Finder</span>
                </div>
                <p className="text-xs text-slate-500">
                  Like original Doodle. Propose candidate dates & times to find when attendees are available.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* General Details */}
        <div className="space-y-4 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Event Title *
            </label>
            <input
              type="text"
              name="title"
              required
              placeholder={eventType === "SIGNUP_SHEET" ? "e.g., Saturday Park Cleanup" : "e.g., Q4 Roadmap Planning Session"}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Description / Notes (Optional)
            </label>
            <textarea
              name="description"
              rows={3}
              placeholder="Add details, instructions, parking info, or meeting agenda..."
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Location / Video Link (Optional)
            </label>
            <input
              type="text"
              name="location"
              placeholder="e.g. 123 Community Center or https://meet.google.com/xyz"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                Organizer Name *
              </label>
              <input
                type="text"
                name="organizerName"
                required
                placeholder="Jane Smith"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                Organizer Email *
              </label>
              <input
                type="email"
                name="organizerEmail"
                required
                placeholder="jane@example.com"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
              <span className="text-[11px] text-slate-500 mt-0.5 block">
                Your secret organizer management link will be sent here.
              </span>
            </div>
          </div>
        </div>

        {/* Dynamic Slots / Options */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                {eventType === "SIGNUP_SHEET" ? "Slots & Items" : "Candidate Meeting Options"} *
              </label>
              <p className="text-xs text-slate-500">
                {eventType === "SIGNUP_SHEET"
                  ? "Define volunteer roles, shifts, or items needed with participant capacity."
                  : "List candidate dates & times for participants to vote on."}
              </p>
            </div>
            <button
              type="button"
              onClick={addSlot}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              + Add Option
            </button>
          </div>

          <div className="space-y-3">
            {slots.map((slot, index) => (
              <div
                key={slot.id}
                className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200"
              >
                <div className="text-xs font-bold text-slate-400 w-5 text-center">
                  {index + 1}.
                </div>

                <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className={eventType === "SIGNUP_SHEET" ? "sm:col-span-2" : "sm:col-span-3"}>
                    <input
                      type="text"
                      name="slotTitle"
                      required
                      placeholder={
                        eventType === "SIGNUP_SHEET"
                          ? "Role or item (e.g., Morning Shift or Watermelon)"
                          : "Date & Time (e.g., Friday Oct 16 @ 1:00 PM - 2:00 PM)"
                      }
                      defaultValue={slot.title}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {eventType === "SIGNUP_SHEET" && (
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500 whitespace-nowrap">Cap:</span>
                        <input
                          type="number"
                          name="slotCapacity"
                          min="1"
                          max="999"
                          defaultValue={slot.capacity}
                          className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  )}
                  {eventType === "TIME_POLL" && (
                    <input type="hidden" name="slotCapacity" value="999" />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => removeSlot(slot.id)}
                  disabled={slots.length <= 1}
                  className="text-slate-400 hover:text-rose-500 font-bold px-2 py-1 disabled:opacity-30 transition-colors"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Submit Button */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 shadow-md transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Creating Event...</span>
              </>
            ) : (
              <span>Create Event & Generate Links →</span>
            )}
          </button>
        </div>
      </Form>
    </div>
  );
}
