// Signup-list PDF export: organizer-only, US Letter, grouped by day, paged.

import { beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { loader } from "~/routes/events.$id.pdf";
import { buildSignupPdf, PAGE_HEIGHT, PAGE_WIDTH } from "~/utils/signup-pdf";
import { groupReport, reportDateLine, reportFileName, reportSummary } from "~/utils/signup-report";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { SITE_URL, routeContext, seedEvent, testEnv } from "./helpers/route-harness";

let db: SqliteD1;
let ip = 0;

beforeEach(() => {
  db = createSqliteD1();
});

async function run(id: string, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request(`${SITE_URL}/events/${id}/pdf`, {
    headers: { "cf-connecting-ip": `198.51.100.${++ip}`, ...headers },
  });
  try {
    return (await loader({ request, params: { id }, context: routeContext(testEnv(db)) } as never)) as Response;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

function addSignup(id: string, slotId: string, name: string, status = "CONFIRMED") {
  db.sqlite
    .prepare(
      `INSERT INTO signups (id, slot_id, event_id, participant_name, participant_email, edit_token, custom_fields, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'x', '{"comment":"hi"}', ?, ?)`
    )
    .run(`su_${name}`, slotId, id, name, `${name}@example.com`, status, new Date().toISOString());
}

describe("GET /events/:id/pdf", () => {
  it("rejects requests without the organizer token", async () => {
    const { id } = await seedEvent(db, { slot: { id: "s1" } });
    expect((await run(id)).status).toBe(403);
  });

  it("downloads a US Letter PDF for the organizer", async () => {
    const { id, adminToken } = await seedEvent(db, { eventDate: "2026-12-05", slot: { id: "s1", capacity: 3 } });
    addSignup(id, "s1", "Ayşe Yılmaz");

    const res = await run(id, { cookie: `mm_admin_${id}=${adminToken}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Park__Cleanup__signup-list.pdf"');

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(pdf.getTitle()).toBe("Park <Cleanup> – Signup list");
  });

  it("is not offered for polls", async () => {
    const { id, adminToken } = await seedEvent(db, { type: "TIME_POLL", slot: { id: "s1" } });
    expect((await run(id, { cookie: `mm_admin_${id}=${adminToken}` })).status).toBe(404);
  });
});

describe("signup list PDF", () => {
  const event = { title: "Fair", organizerName: "Sam", eventDate: "2026-12-05" };
  const site = { siteName: "ManyMano", eventUrl: "https://example.com/events/x" };

  it("flows long sheets onto more Letter pages", async () => {
    const slots = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, title: `Slot ${i}`, capacity: 8, displayOrder: i }));
    const bytes = await buildSignupPdf({ event, slots, signups: [], ...site });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(2);
    for (const p of pdf.getPages()) expect(p.getSize()).toEqual({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  });

  it("handles characters outside the embedded font", async () => {
    const bytes = await buildSignupPdf({
      event: { ...event, title: "Potluck 🍲 中文" },
      slots: [{ id: "a", title: "Dish", capacity: 1 }],
      signups: [{ slotId: "a", participantName: "李雷 😀", createdAt: "2026-01-01" }],
      ...site,
    });
    expect((await PDFDocument.load(bytes)).getTitle()).toBe("Potluck ? ?? – Signup list");
  });

  it("groups slots by day, keeping the organizer's order within a day", () => {
    const slots = [
      { id: "b", title: "B", capacity: 1, slotDate: "2026-12-07", displayOrder: 0 },
      { id: "a", title: "A", capacity: 1, slotDate: "2026-12-06", startTime: "10:00", displayOrder: 2 },
      { id: "c", title: "C", capacity: -1, slotDate: "2026-12-06", displayOrder: 1 },
    ];
    const sections = groupReport(event, slots, []);
    expect(sections.map((s) => s.date)).toEqual(["2026-12-06", "2026-12-07"]);
    expect(sections[0].slots.map((s) => s.slot.id)).toEqual(["c", "a"]);
    expect(reportDateLine(event, sections)).toBe("Sun, Dec 6 – Mon, Dec 7, 2026");
    expect(reportSummary(slots, sections)).toBe("0 signups");
    expect(reportSummary(slots.slice(0, 2), sections)).toBe("0 of 2 spots filled");
    expect(reportFileName("Bake sale!")).toBe("Bake_sale__signup-list.pdf");
  });
});
