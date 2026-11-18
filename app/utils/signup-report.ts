// Shared, dependency-free parts of the signup-list PDF: grouping slots by
// day and the summary line. The PDF drawing lives in signup-pdf.ts, which
// the route loads lazily so pdf-lib never weighs on other requests.

import { effectiveDateForSlot, formatLongDateLabel, formatSlotDateLabel } from "./calendar";

export interface ReportEvent {
  title: string;
  description?: string | null;
  eventDate?: string | null;
  location?: string | null;
  organizerName: string;
  timezone?: string | null;
}

export interface ReportSlot {
  id: string;
  title: string;
  shiftName?: string | null;
  slotDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  capacity: number;
  displayOrder?: number | null;
}

export interface ReportSignup {
  slotId: string;
  participantName: string;
  participantEmail?: string | null;
  customFields?: string | null;
  createdAt: string;
}

export interface ReportSection {
  date: string | null;
  slots: Array<{ slot: ReportSlot; signups: ReportSignup[] }>;
}

/** Blank "Available" lines printed per slot, so a big slot can't run to pages of empties. */
export const MAX_BLANK_ROWS = 25;

export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

export function slotTimeRange(slot: ReportSlot): string {
  if (slot.startTime) {
    return `${formatTime(slot.startTime)}${slot.endTime ? ` – ${formatTime(slot.endTime)}` : ""}`;
  }
  return slot.endTime ? formatTime(slot.endTime) : "";
}

export function signupComment(customFields: string | null | undefined): string {
  try {
    const parsed = JSON.parse(customFields || "{}");
    return typeof parsed?.comment === "string" ? parsed.comment : "";
  } catch {
    return "";
  }
}

/** Slots grouped by day (in date order, organizer's order within a day), signups oldest first. */
export function groupReport(event: ReportEvent, slots: ReportSlot[], signups: ReportSignup[]): ReportSection[] {
  const bySlot = new Map<string, ReportSignup[]>();
  for (const s of signups) {
    const list = bySlot.get(s.slotId);
    if (list) list.push(s);
    else bySlot.set(s.slotId, [s]);
  }
  for (const list of bySlot.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const ordered = slots
    .map((slot, i) => ({ slot, i }))
    .sort((a, b) => {
      const d = (effectiveDateForSlot(a.slot, event.eventDate) || "").localeCompare(
        effectiveDateForSlot(b.slot, event.eventDate) || ""
      );
      if (d !== 0) return d;
      return (a.slot.displayOrder ?? 0) - (b.slot.displayOrder ?? 0) || a.i - b.i;
    })
    .map(({ slot }) => slot);

  const sections: ReportSection[] = [];
  for (const slot of ordered) {
    const date = effectiveDateForSlot(slot, event.eventDate);
    let section = sections[sections.length - 1];
    if (!section || section.date !== date) {
      section = { date, slots: [] };
      sections.push(section);
    }
    section.slots.push({ slot, signups: bySlot.get(slot.id) || [] });
  }
  return sections;
}

/** "Saturday, December 5th, 2026", or "Sat, Dec 5 – Sun, Dec 6, 2026" across days. */
export function reportDateLine(event: ReportEvent, sections: ReportSection[]): string {
  const first = sections[0]?.date ?? event.eventDate;
  if (sections.length <= 1) return formatLongDateLabel(first);
  const last = sections[sections.length - 1].date;
  const year = last?.match(/^\d{4}/) ? `, ${last.slice(0, 4)}` : "";
  return `${formatSlotDateLabel(first)} – ${formatSlotDateLabel(last)}${year}`;
}

/** "4 of 9 spots filled" ("4 signups" once any slot is unlimited). */
export function reportSummary(slots: ReportSlot[], sections: ReportSection[]): string {
  const filled = sections.reduce((n, sec) => n + sec.slots.reduce((m, s) => m + s.signups.length, 0), 0);
  if (slots.some((s) => s.capacity <= 0)) return `${filled} ${filled === 1 ? "signup" : "signups"}`;
  const total = slots.reduce((n, s) => n + Math.max(0, s.capacity), 0);
  return `${filled} of ${total} ${total === 1 ? "spot" : "spots"} filled`;
}

/** Safe download name, same rule as the CSV export. */
export function reportFileName(title: string): string {
  return `${title.replace(/[^a-zA-Z0-9_-]/g, "_")}_signup-list.pdf`;
}
