// Server half of the create-page prefill: reads a template or a source event
// and returns the normalized prefill (see ~/utils/prefill).
//
// A copy reads only public structure, through an explicit projection: never
// the organizer's name or email, the admin token, sign-ups, votes, or
// finalization. Availability follows the public event page exactly — an
// expired event still sitting in storage is not copyable.
import { eq } from "drizzle-orm";
import { events, eventSlots } from "~/db";
import { isExpired } from "~/utils/retention";
import {
  isUnsupported,
  pollPrefillFromEvent,
  signupPrefillFromEvent,
  type PollPrefill,
  type PrefillLoad,
  type SignupPrefill,
  type SourceEvent,
  type SourceSlot,
} from "~/utils/prefill";
import {
  getTemplate,
  pollPrefillFromTemplate,
  signupPrefillFromTemplate,
} from "~/utils/templates";

export type CreateFlow = "signup" | "poll";

const EVENT_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The public structure of an event, or null when it doesn't exist or has
 * expired. DB errors propagate — a failed read is not a missing event.
 */
export async function loadSourceEvent(
  // Drizzle's D1 client; typed loosely like the other DB helpers.
  db: any,
  eventId: string,
  retentionDays: number,
  now: Date = new Date()
): Promise<{ event: SourceEvent; slots: SourceSlot[] } | null> {
  if (!EVENT_ID_RE.test(eventId)) return null;
  const [row] = await db
    .select({
      id: events.id,
      type: events.type,
      title: events.title,
      description: events.description,
      location: events.location,
      eventDate: events.eventDate,
      timezone: events.timezone,
      durationMinutes: events.durationMinutes,
      settings: events.settings,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) return null;

  const slots: SourceSlot[] = await db
    .select({
      id: eventSlots.id,
      title: eventSlots.title,
      shiftName: eventSlots.shiftName,
      capacity: eventSlots.capacity,
      slotDate: eventSlots.slotDate,
      startTime: eventSlots.startTime,
      endTime: eventSlots.endTime,
      displayOrder: eventSlots.displayOrder,
    })
    .from(eventSlots)
    .where(eq(eventSlots.eventId, eventId));

  // Same rule as the event page: sheets live until their last date leaves the
  // window; polls expire by creation date only.
  const lastSlotDate =
    row.type === "SIGNUP_SHEET"
      ? slots.reduce<string | null>((latest, s) => (s.slotDate && (!latest || s.slotDate > latest) ? s.slotDate : latest), null)
      : null;
  if (isExpired(row.createdAt, now, retentionDays) && isExpired(row.createdAt, now, retentionDays, lastSlotDate)) {
    return null;
  }

  const { createdAt: _createdAt, ...event } = row;
  return { event, slots };
}

type FlowPrefill<F extends CreateFlow> = F extends "signup" ? SignupPrefill : PollPrefill;

/**
 * Reads `?from=<event id>` (wins) or `?template=<slug>` for a create page.
 * A source meant for the other create page comes back as a redirect there,
 * carrying only that one parameter.
 */
export async function loadCreatePrefill<F extends CreateFlow>(
  flow: F,
  url: URL,
  deps: { db: () => any; retentionDays: number; now?: Date }
): Promise<{ redirect: string } | PrefillLoad<FlowPrefill<F>>> {
  const from = (url.searchParams.get("from") || "").trim();
  const templateSlug = (url.searchParams.get("template") || "").trim();
  const wantType = flow === "signup" ? "SIGNUP_SHEET" : "TIME_POLL";
  const otherFlow: CreateFlow = flow === "signup" ? "poll" : "signup";

  if (from) {
    const source = await loadSourceEvent(deps.db(), from, deps.retentionDays, deps.now);
    if (!source) return { status: "missing", source: "clone" };
    if (source.event.type !== wantType) {
      return { redirect: `/create/${otherFlow}?from=${encodeURIComponent(from)}` };
    }
    const built =
      flow === "signup"
        ? signupPrefillFromEvent(source.event, source.slots)
        : pollPrefillFromEvent(source.event, source.slots);
    if (isUnsupported(built)) return { status: "unsupported", reason: built.reason, eventId: source.event.id };
    return { status: "ready", prefill: built.prefill as FlowPrefill<F> };
  }

  if (templateSlug) {
    const template = getTemplate(templateSlug);
    if (!template) return { status: "missing", source: "template" };
    if (template.type !== wantType) {
      return { redirect: `/create/${otherFlow}?template=${encodeURIComponent(template.slug)}` };
    }
    const prefill = template.type === "SIGNUP_SHEET" ? signupPrefillFromTemplate(template) : pollPrefillFromTemplate(template);
    return { status: "ready", prefill: prefill as FlowPrefill<F> };
  }

  return { status: "none" };
}
