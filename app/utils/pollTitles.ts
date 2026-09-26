// The title a poll option gets when the organizer leaves its label blank.
//
// Shared by the create action (which stores it) and the copy flow (which has
// to recognise it, so a copied option regenerates its title from its new date
// instead of carrying the old date in its label). Keep both on this one
// function: a formatting change here must change both at once.
import { formatSlotDateLabel } from "~/utils/calendar";

/** "13:05" → "1:05 PM". Anything unparseable is returned as-is. */
export function formatTimeDisplay(t: string): string {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

/**
 * "Fri, Sep 12 · 10:00 AM – 11:00 AM", or "Fri, Sep 12 · All day" when the
 * option has no start time (an all-day poll).
 */
export function pollDefaultTitle(date: string, start: string | null, end: string | null): string {
  if (!start) return `${formatSlotDateLabel(date)} · All day`;
  return `${formatSlotDateLabel(date)} · ${formatTimeDisplay(start)} – ${formatTimeDisplay(end || "")}`;
}
