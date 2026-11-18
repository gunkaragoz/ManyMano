// Printable signup-sheet report ("Download PDF" on the organizer roster).
//
// Rendered as a standalone, print-styled HTML page that opens the browser's
// print dialog, where "Save as PDF" produces the file. The browser does the
// typesetting, so names in any script (ğ, ş, 中文, emoji) come out right —
// a hand-built PDF with the standard fonts only covers Latin-1.

import { escapeHtml } from "./sanitize";
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

/** Blank "open spot" lines printed per slot, so a long slot can't run to pages of empties. */
export const MAX_BLANK_ROWS = 25;

function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

function timeRange(slot: ReportSlot): string {
  if (slot.startTime) {
    return `${formatTime(slot.startTime)}${slot.endTime ? ` – ${formatTime(slot.endTime)}` : ""}`;
  }
  return slot.endTime ? formatTime(slot.endTime) : "";
}

function commentOf(customFields: string | null | undefined): string {
  try {
    const parsed = JSON.parse(customFields || "{}");
    return typeof parsed?.comment === "string" ? parsed.comment : "";
  } catch {
    return "";
  }
}

export interface ReportSection {
  date: string | null;
  slots: Array<{ slot: ReportSlot; signups: ReportSignup[] }>;
}

/** Slots grouped by day (in date order), each with its confirmed signups oldest first. */
export function groupReport(event: ReportEvent, slots: ReportSlot[], signups: ReportSignup[]): ReportSection[] {
  const bySlot = new Map<string, ReportSignup[]>();
  for (const s of signups) {
    const list = bySlot.get(s.slotId);
    if (list) list.push(s);
    else bySlot.set(s.slotId, [s]);
  }
  for (const list of bySlot.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Day by day, keeping the organizer's slot order within each day (as on the sheet).
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

export function buildSignupReportHtml(args: {
  event: ReportEvent;
  slots: ReportSlot[];
  signups: ReportSignup[];
  siteName: string;
  eventUrl: string;
  nonce: string;
  generatedAt?: Date;
}): string {
  const { event, slots, signups, siteName, eventUrl, nonce } = args;
  const generatedAt = args.generatedAt ?? new Date();
  const sections = groupReport(event, slots, signups);
  const multiDay = sections.length > 1;

  const filled = signups.filter((s) => slots.some((sl) => sl.id === s.slotId)).length;
  const hasUnlimited = slots.some((s) => s.capacity < 0);
  const totalSpots = slots.reduce((n, s) => n + (s.capacity > 0 ? s.capacity : 0), 0);
  const summary = hasUnlimited
    ? `${filled} ${filled === 1 ? "signup" : "signups"}`
    : `${filled} of ${totalSpots} ${totalSpots === 1 ? "spot" : "spots"} filled`;

  const first = sections[0]?.date ?? event.eventDate;
  const last = sections[sections.length - 1]?.date;
  const dateLine = multiDay
    ? `${formatSlotDateLabel(first)} – ${formatSlotDateLabel(last)}${last?.match(/^\d{4}/) ? `, ${last.slice(0, 4)}` : ""}`
    : formatLongDateLabel(first);

  const meta = [
    dateLine ? `<div><span class="k">Date</span> ${escapeHtml(dateLine)}</div>` : "",
    event.location ? `<div><span class="k">Location</span> ${escapeHtml(event.location)}</div>` : "",
    `<div><span class="k">Organizer</span> ${escapeHtml(event.organizerName)}</div>`,
    event.timezone && event.timezone !== "UTC"
      ? `<div><span class="k">Time zone</span> ${escapeHtml(event.timezone)}</div>`
      : "",
    `<div><span class="k">Status</span> ${escapeHtml(summary)}</div>`,
  ].join("");

  const slotHtml = (slot: ReportSlot, list: ReportSignup[]): string => {
    const time = timeRange(slot);
    const shift = (slot.shiftName || "").trim();
    const capLabel =
      slot.capacity < 0
        ? `${list.length} signed up`
        : `${Math.min(list.length, slot.capacity)} of ${slot.capacity} filled`;
    const open = slot.capacity < 0 ? 0 : Math.max(0, slot.capacity - list.length);
    const blank = Math.min(open, MAX_BLANK_ROWS);

    const rows = list
      .map(
        (s, i) => `<tr>
  <td class="n">${i + 1}</td>
  <td class="name">${escapeHtml(s.participantName)}</td>
  <td class="email">${escapeHtml(s.participantEmail || "")}</td>
  <td class="note">${escapeHtml(commentOf(s.customFields))}</td>
</tr>`
      )
      .join("");
    const blanks = Array.from(
      { length: blank },
      (_, i) => `<tr class="open">
  <td class="n">${list.length + i + 1}</td>
  <td class="name">Available</td>
  <td class="email"></td>
  <td class="note"></td>
</tr>`
    ).join("");
    const more =
      open > blank
        ? `<tr class="open"><td></td><td colspan="3">+ ${open - blank} more open ${open - blank === 1 ? "spot" : "spots"}</td></tr>`
        : "";
    const empty =
      list.length === 0 && blank === 0
        ? `<tr class="open"><td></td><td colspan="3">No signups yet</td></tr>`
        : "";

    return `<section class="slot">
  <div class="slot-head">
    <div>
      <div class="slot-title">${escapeHtml(slot.title)}</div>
      ${time || shift ? `<div class="slot-sub">${escapeHtml([shift, time].filter(Boolean).join(" · "))}</div>` : ""}
    </div>
    <div class="cap">${escapeHtml(capLabel)}</div>
  </div>
  <table>
    <thead><tr><th class="n">#</th><th class="name">Name</th><th class="email">Email</th><th class="note">Comment</th></tr></thead>
    <tbody>${rows}${blanks}${more}${empty}</tbody>
  </table>
</section>`;
  };

  const body = sections
    .map(
      (sec) =>
        `${multiDay && sec.date ? `<h2 class="day">${escapeHtml(formatLongDateLabel(sec.date))}</h2>` : ""}${sec.slots
          .map(({ slot, signups: list }) => slotHtml(slot, list))
          .join("")}`
    )
    .join("");

  const fileTitle = `${event.title} – Signup list`;
  const generated = generatedAt.toISOString().slice(0, 16).replace("T", " ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(fileTitle)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f1f5f9; color: #0f172a; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  .bar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; padding: 10px 16px; background: #0f172a; color: #fff; }
  .bar .hint { font-size: 12px; color: #cbd5e1; }
  .bar .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .bar label { font-size: 12px; display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
  .bar button, .bar a { font: inherit; font-size: 12px; font-weight: 700; padding: 7px 12px; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: #fff; cursor: pointer; text-decoration: none; }
  .bar button.primary { background: #4f46e5; border-color: #4f46e5; }
  .page { max-width: 820px; margin: 16px auto; padding: 32px 36px; background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
  h1 { margin: 0 0 4px; font-size: 22px; line-height: 1.25; }
  .desc { margin: 4px 0 0; color: #475569; white-space: pre-wrap; }
  .meta { margin: 14px 0 6px; display: flex; flex-wrap: wrap; gap: 4px 28px; }
  .meta .k { margin-right: 6px; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  h2.day { margin: 22px 0 8px; padding-bottom: 4px; font-size: 15px; border-bottom: 2px solid #0f172a; break-after: avoid; }
  .slot { margin: 12px 0 0; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; break-inside: avoid; }
  .slot-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 8px 10px; background: #f1f5f9; border-bottom: 1px solid #cbd5e1; }
  .slot-title { font-weight: 700; font-size: 14px; }
  .slot-sub { color: #475569; font-size: 12px; }
  .cap { white-space: nowrap; font-size: 12px; font-weight: 700; color: #334155; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 5px 10px; text-align: left; vertical-align: top; border-top: 1px solid #e2e8f0; overflow-wrap: anywhere; }
  thead th { border-top: 0; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; }
  .n { width: 34px; color: #94a3b8; }
  .name { width: 32%; font-weight: 600; }
  .email { width: 30%; }
  tr.open td { color: #94a3b8; font-style: italic; font-weight: 400; }
  tr.open td.name { height: 26px; }
  .foot { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; gap: 12px; color: #94a3b8; font-size: 10px; }
  body.no-email .email { display: none; }
  body.no-email .name { width: 45%; }
  @media (max-width: 600px) { .page { margin: 0; padding: 20px 16px; box-shadow: none; } }
  @page { size: auto; margin: 14mm 12mm; }
  @media print {
    body { background: #fff; font-size: 11px; }
    .bar { display: none; }
    .page { max-width: none; margin: 0; padding: 0; box-shadow: none; }
    .slot-head, thead { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="bar">
  <span class="hint">Choose <strong>Save as PDF</strong> as the printer to download this list.</span>
  <div class="actions">
    <label><input type="checkbox" id="show-email" checked> Show emails</label>
    <a href="${escapeHtml(eventUrl)}">Back to event</a>
    <button type="button" class="primary" id="print">Save as PDF</button>
  </div>
</div>
<main class="page">
  <h1>${escapeHtml(event.title)}</h1>
  ${event.description ? `<p class="desc">${escapeHtml(event.description)}</p>` : ""}
  <div class="meta">${meta}</div>
  ${body || `<p class="desc">This sheet has no slots yet.</p>`}
  <div class="foot"><span>${escapeHtml(siteName)} · ${escapeHtml(eventUrl)}</span><span>Generated ${escapeHtml(generated)} UTC</span></div>
</main>
<script nonce="${escapeHtml(nonce)}">
  (function () {
    var btn = document.getElementById("print");
    var box = document.getElementById("show-email");
    btn.addEventListener("click", function () { window.print(); });
    box.addEventListener("change", function () { document.body.classList.toggle("no-email", !box.checked); });
    if (new URLSearchParams(location.search).get("print") === "1") {
      window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 150); });
    }
  })();
</script>
</body>
</html>`;
}
