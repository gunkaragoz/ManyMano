// Signup-list PDF for organizers: US Letter, event details up top, slots
// grouped by day, a running header on later pages and "Page X of Y" on
// every page. Built on the Worker with pdf-lib so every browser gets the
// same file. Inter (OFL, subset to Latin, Greek and Cyrillic) is embedded
// so names like "Ayşe Yılmaz" render; any other character prints as "?".

import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import interRegularUrl from "~/assets/fonts/Inter-Regular.ttf?inline";
import interSemiBoldUrl from "~/assets/fonts/Inter-SemiBold.ttf?inline";
import {
  MAX_BLANK_ROWS,
  groupReport,
  reportDateLine,
  reportSummary,
  signupComment,
  slotTimeRange,
  type ReportEvent,
  type ReportSignup,
  type ReportSlot,
} from "./signup-report";
import { formatLongDateLabel } from "./calendar";

// US Letter in points.
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
const MARGIN_X = 50;
const MARGIN_TOP = 50;
const MARGIN_BOTTOM = 58;
const CONTENT_W = PAGE_WIDTH - MARGIN_X * 2;

const INK = rgb(0.059, 0.09, 0.165); // slate-900
const BODY = rgb(0.2, 0.255, 0.333); // slate-700
const MUTED = rgb(0.392, 0.455, 0.545); // slate-500
const FAINT = rgb(0.58, 0.639, 0.722); // slate-400
const RULE = rgb(0.796, 0.835, 0.882); // slate-300
const HAIRLINE = rgb(0.886, 0.91, 0.941); // slate-200
const FILL = rgb(0.945, 0.961, 0.976); // slate-100
const ACCENT = rgb(0.31, 0.275, 0.898); // indigo-600

// Table columns: #, Name, Email, Comment.
const PAD = 6;
const COLS = [
  { key: "n", w: 26 },
  { key: "name", w: 150 },
  { key: "email", w: 165 },
  { key: "note", w: CONTENT_W - 26 - 150 - 165 },
] as const;
const ROW_SIZE = 9;
const ROW_LEAD = 12;
const OPEN_ROW_H = 22; // room to write a name in by hand

let fontBytes: { regular: Uint8Array; semibold: Uint8Array } | null = null;

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function loadFontBytes() {
  fontBytes ??= { regular: dataUrlBytes(interRegularUrl), semibold: dataUrlBytes(interSemiBoldUrl) };
  return fontBytes;
}

interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  clean: (s: string | null | undefined) => string;
}

/** Word-wrap to `width`, breaking over-long tokens (emails, URLs) by character. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** One line, trimmed with an ellipsis to fit `width`. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function clamp(lines: string[], max: number, font: PDFFont, size: number, width: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = fit(`${kept[max - 1]}…`, font, size, width);
  return kept;
}

export async function buildSignupPdf(args: {
  event: ReportEvent;
  slots: ReportSlot[];
  signups: ReportSignup[];
  siteName: string;
  eventUrl: string;
  generatedAt?: Date;
}): Promise<Uint8Array> {
  const { event, slots, signups, siteName, eventUrl } = args;
  const generatedAt = args.generatedAt ?? new Date();

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = loadFontBytes();
  const regular = await doc.embedFont(bytes.regular, { subset: true });
  const semibold = await doc.embedFont(bytes.semibold, { subset: true });
  const supported = new Set(regular.getCharacterSet());
  const clean = (s: string | null | undefined): string =>
    Array.from(
      String(s ?? "")
        .normalize("NFC")
        .replace(/\r\n?/g, "\n")
        .replace(/\t/g, " ")
        .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    )
      .map((ch) => (ch === "\n" || supported.has(ch.codePointAt(0)!) ? ch : "?"))
      .join("")
      .trim();
  const f: Fonts = { regular, semibold, clean };

  const title = clean(event.title) || "Signup list";
  doc.setTitle(`${title} – Signup list`, { showInWindowTitleBar: true });
  doc.setCreator(siteName);
  doc.setProducer(siteName);
  doc.setCreationDate(generatedAt);
  doc.setModificationDate(generatedAt);

  const sections = groupReport(event, slots, signups);
  const dateLine = clean(reportDateLine(event, sections));
  const summary = reportSummary(slots, sections);
  const multiDay = sections.length > 1;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0; // distance from the top of the page

  const text = (s: string, x: number, top: number, size: number, font: PDFFont, color: RGB) => {
    if (s) page.drawText(s, { x, y: PAGE_HEIGHT - top - size * 0.8, size, font, color });
  };
  const hline = (top: number, color: RGB, thickness = 0.6, x1 = MARGIN_X, x2 = PAGE_WIDTH - MARGIN_X) =>
    page.drawLine({ start: { x: x1, y: PAGE_HEIGHT - top }, end: { x: x2, y: PAGE_HEIGHT - top }, thickness, color });
  const room = () => PAGE_HEIGHT - MARGIN_BOTTOM - y;

  const newPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = MARGIN_TOP;
    if (pages.length > 1) {
      // Running header: event title left, dates right.
      const right = dateLine;
      const rightW = right ? f.regular.widthOfTextAtSize(right, 8.5) : 0;
      text(fit(title, f.semibold, 8.5, CONTENT_W - rightW - 16), MARGIN_X, y, 8.5, f.semibold, BODY);
      if (right) text(right, PAGE_WIDTH - MARGIN_X - rightW, y, 8.5, f.regular, MUTED);
      y += 14;
      hline(y, RULE);
      y += 16;
    }
  };

  // ---- First-page header ---------------------------------------------------
  newPage();
  text("SIGNUP LIST", MARGIN_X, y, 8, f.semibold, ACCENT);
  y += 15;
  for (const line of clamp(wrap(title, f.semibold, 20, CONTENT_W), 3, f.semibold, 20, CONTENT_W)) {
    text(line, MARGIN_X, y, 20, f.semibold, INK);
    y += 25;
  }
  const description = clean(event.description);
  if (description) {
    y += 1;
    for (const line of clamp(wrap(description, f.regular, 9.5, CONTENT_W), 6, f.regular, 9.5, CONTENT_W)) {
      text(line, MARGIN_X, y, 9.5, f.regular, BODY);
      y += 13.5;
    }
  }
  y += 10;

  // Event details: two columns of label / value.
  const details: Array<[string, string]> = [];
  if (dateLine) details.push(["Date", dateLine]);
  if (clean(event.location)) details.push(["Location", clean(event.location)]);
  details.push(["Organizer", clean(event.organizerName)]);
  if (event.timezone && event.timezone !== "UTC") details.push(["Time zone", clean(event.timezone)]);
  details.push(["Signups", summary]);

  const colW = (CONTENT_W - 24) / 2;
  const labelW = 62;
  hline(y, RULE);
  y += 10;
  for (let i = 0; i < details.length; i += 2) {
    let rowH = 0;
    for (let c = 0; c < 2; c++) {
      const item = details[i + c];
      if (!item) continue;
      const x = MARGIN_X + c * (colW + 24);
      text(item[0].toUpperCase(), x, y + 1.5, 7, f.semibold, MUTED);
      const lines = clamp(wrap(item[1], f.regular, 9.5, colW - labelW), 3, f.regular, 9.5, colW - labelW);
      lines.forEach((line, li) => text(line, x + labelW, y + li * 13, 9.5, f.regular, INK));
      rowH = Math.max(rowH, lines.length * 13);
    }
    y += rowH + 5;
  }
  y += 4;
  hline(y, RULE);
  y += 18;

  // ---- Slots ---------------------------------------------------------------
  const colX = (i: number) => MARGIN_X + COLS.slice(0, i).reduce((n, c) => n + c.w, 0);

  const slotHeaderHeight = (slot: ReportSlot) => {
    const sub = [clean(slot.shiftName), slotTimeRange(slot)].filter(Boolean).join(" · ");
    return 8 + 13 + (sub ? 12 : 0) + 6;
  };

  const drawSlotHeader = (slot: ReportSlot, count: string, continued: boolean) => {
    const sub = [clean(slot.shiftName), slotTimeRange(slot)].filter(Boolean).join(" · ");
    const h = slotHeaderHeight(slot);
    page.drawRectangle({
      x: MARGIN_X,
      y: PAGE_HEIGHT - y - h,
      width: CONTENT_W,
      height: h,
      color: FILL,
    });
    hline(y + h, RULE);
    const countW = f.semibold.widthOfTextAtSize(count, 8.5);
    const label = `${clean(slot.title) || "Untitled slot"}${continued ? " (continued)" : ""}`;
    text(fit(label, f.semibold, 10.5, CONTENT_W - countW - PAD * 2 - 16), MARGIN_X + PAD + 2, y + 8, 10.5, f.semibold, INK);
    text(count, PAGE_WIDTH - MARGIN_X - PAD - 2 - countW, y + 9.5, 8.5, f.semibold, BODY);
    if (sub) text(fit(sub, f.regular, 8.5, CONTENT_W - PAD * 2), MARGIN_X + PAD + 2, y + 22, 8.5, f.regular, MUTED);
    y += h;
    // Column headings.
    const heads = ["#", "NAME", "EMAIL", "COMMENT"];
    heads.forEach((hd, i) => text(hd, colX(i) + PAD, y + 6, 6.5, f.semibold, MUTED));
    y += 17;
    hline(y, HAIRLINE);
  };

  const HEAD_ROW_H = 17;

  type Row = { cells: string[][]; open: boolean; height: number };
  const signupRow = (n: number, s: ReportSignup): Row => {
    const values = [String(n), clean(s.participantName), clean(s.participantEmail), clean(signupComment(s.customFields))];
    const cells = values.map((v, i) => {
      const font = i === 1 ? f.semibold : f.regular;
      return clamp(wrap(v, font, ROW_SIZE, COLS[i].w - PAD * 2), 6, font, ROW_SIZE, COLS[i].w - PAD * 2);
    });
    const lines = Math.max(...cells.map((c) => c.length));
    return { cells, open: false, height: Math.max(OPEN_ROW_H, lines * ROW_LEAD + 10) };
  };

  const drawRow = (row: Row) => {
    row.cells.forEach((lines, i) => {
      const font = i === 1 && !row.open ? f.semibold : f.regular;
      const color = row.open ? FAINT : i === 0 ? FAINT : i === 1 ? INK : BODY;
      lines.forEach((line, li) => text(line, colX(i) + PAD, y + 6 + li * ROW_LEAD, ROW_SIZE, font, color));
    });
    y += row.height;
    hline(y, HAIRLINE);
  };

  for (const section of sections) {
    for (const [idx, { slot, signups: list }] of section.slots.entries()) {
      const capacity = slot.capacity;
      const count =
        capacity < 0 ? `${list.length} signed up` : `${Math.min(list.length, capacity)} of ${capacity} filled`;
      const open = capacity < 0 ? 0 : Math.max(0, capacity - list.length);
      const blanks = Math.min(open, MAX_BLANK_ROWS);

      const rows: Row[] = list.map((s, i) => signupRow(i + 1, s));
      for (let i = 0; i < blanks; i++) {
        rows.push({ cells: [[String(list.length + i + 1)], ["Available"], [], []], open: true, height: OPEN_ROW_H });
      }
      if (open > blanks) {
        const more = open - blanks;
        rows.push({ cells: [[""], [`+ ${more} more open ${more === 1 ? "spot" : "spots"}`], [], []], open: true, height: OPEN_ROW_H });
      }
      if (rows.length === 0) rows.push({ cells: [[""], ["No signups yet"], [], []], open: true, height: OPEN_ROW_H });

      // A slot that fits on one page never splits; a longer one starts on a
      // page with room for its header and first rows. The day heading stays
      // with its first slot either way.
      const dayHeading = multiDay && idx === 0 && section.date ? clean(formatLongDateLabel(section.date)) : "";
      const headingH = dayHeading ? 26 : 0;
      const top = headingH + slotHeaderHeight(slot) + HEAD_ROW_H;
      const whole = top + rows.reduce((n, r) => n + r.height, 0);
      const firstRows = rows.slice(0, 2).reduce((n, r) => n + r.height, 0);
      const freshPage = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM - 30; // minus the running header
      const needed = whole <= freshPage ? whole : top + firstRows;
      if (room() < needed && y > MARGIN_TOP + 40) newPage();

      if (dayHeading) {
        text(dayHeading, MARGIN_X, y, 12, f.semibold, INK);
        y += 17;
        hline(y, INK, 1.2);
        y += 9;
      }

      drawSlotHeader(slot, count, false);
      for (const row of rows) {
        if (room() < row.height) {
          newPage();
          drawSlotHeader(slot, count, true);
        }
        drawRow(row);
      }
      y += 16;
    }
  }

  if (sections.length === 0) {
    text("This sheet has no slots yet.", MARGIN_X, y, 10, f.regular, MUTED);
  }

  // ---- Footer on every page (needs the final page count) -------------------
  const dateOpts = { year: "numeric", month: "short", day: "numeric" } as const;
  let generated: string;
  try {
    generated = generatedAt.toLocaleDateString("en-US", { ...dateOpts, timeZone: event.timezone || "UTC" });
  } catch {
    generated = generatedAt.toLocaleDateString("en-US", { ...dateOpts, timeZone: "UTC" });
  }
  const footLeft = `${clean(siteName)} · ${eventUrl.replace(/^https?:\/\//, "")}`;
  pages.forEach((p, i) => {
    page = p;
    const top = PAGE_HEIGHT - 36;
    hline(top - 10, HAIRLINE);
    const right = `Page ${i + 1} of ${pages.length}`;
    const center = `Generated ${generated}`;
    const rightW = f.regular.widthOfTextAtSize(right, 7.5);
    const centerW = f.regular.widthOfTextAtSize(center, 7.5);
    text(fit(footLeft, f.regular, 7.5, CONTENT_W / 2 - centerW / 2 - 12), MARGIN_X, top, 7.5, f.regular, FAINT);
    text(center, (PAGE_WIDTH - centerW) / 2, top, 7.5, f.regular, FAINT);
    text(right, PAGE_WIDTH - MARGIN_X - rightW, top, 7.5, f.semibold, MUTED);
  });

  return doc.save();
}
