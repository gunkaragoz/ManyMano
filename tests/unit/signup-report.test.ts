// PDF (print) export of a signup sheet: organizer-only, escaped, grouped.

import { beforeEach, describe, expect, it } from "vitest";
import { loader } from "~/routes/events.$id.pdf";
import { buildSignupReportHtml, groupReport, MAX_BLANK_ROWS } from "~/utils/signup-report";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { SITE_URL, routeContext, seedEvent, testEnv } from "./helpers/route-harness";

let db: SqliteD1;
let ip = 0;

beforeEach(() => {
  db = createSqliteD1();
});

async function run(id: string, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request(`${SITE_URL}/events/${id}/pdf?print=1`, {
    headers: { "cf-connecting-ip": `198.51.100.${++ip}`, ...headers },
  });
  try {
    return (await loader({ request, params: { id }, context: routeContext(testEnv(db)) } as never)) as Response;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

function addSignup(id: string, slotId: string, name: string, email: string, comment = "", status = "CONFIRMED") {
  db.sqlite
    .prepare(
      `INSERT INTO signups (id, slot_id, event_id, participant_name, participant_email, edit_token, custom_fields, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?)`
    )
    .run(`su_${name}`, slotId, id, name, email, JSON.stringify({ comment }), status, new Date().toISOString());
}

describe("GET /events/:id/pdf", () => {
  it("rejects requests without the organizer token", async () => {
    const { id } = await seedEvent(db, { slot: { id: "s1" } });
    const res = await run(id);
    expect(res.status).toBe(403);
  });

  it("renders an escaped, nonce-scripted report for the organizer", async () => {
    const { id, adminToken } = await seedEvent(db, {
      eventDate: "2026-12-05",
      slot: { id: "s1", title: "Bring <snacks>", capacity: 3, startTime: "09:00" },
    });
    addSignup(id, "s1", "Ayşe <b>Yılmaz</b>", "ayse@example.com", "Gluten-free");
    addSignup(id, "s1", "Gone", "gone@example.com", "", "CANCELLED");

    const res = await run(id, { cookie: `mm_admin_${id}=${adminToken}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const csp = res.headers.get("content-security-policy") || "";
    const nonce = csp.match(/'nonce-([a-z0-9]+)'/)?.[1];
    expect(nonce).toBeTruthy();

    const html = await res.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain("Park &lt;Cleanup&gt;");
    expect(html).toContain("Bring &lt;snacks&gt;");
    expect(html).toContain("Ayşe &lt;b&gt;Yılmaz&lt;/b&gt;");
    expect(html).not.toContain("<b>Yılmaz");
    expect(html).toContain("Gluten-free");
    expect(html).not.toContain("gone@example.com");
    expect(html).toContain("1 of 3 filled");
    expect(html.match(/<tr class="open">/g)?.length).toBe(2);
    expect(html).toContain("9:00 AM");
  });

  it("is not offered for polls", async () => {
    const { id, adminToken } = await seedEvent(db, { type: "TIME_POLL", slot: { id: "s1" } });
    const res = await run(id, { cookie: `mm_admin_${id}=${adminToken}` });
    expect(res.status).toBe(404);
  });
});

describe("signup report layout", () => {
  const event = { title: "Fair", organizerName: "Sam", eventDate: "2026-12-05" };

  it("groups slots by day, keeping the organizer's order within a day", () => {
    const sections = groupReport(
      event,
      [
        { id: "b", title: "B", capacity: 1, slotDate: "2026-12-07", displayOrder: 0 },
        { id: "a", title: "A", capacity: 1, slotDate: "2026-12-06", startTime: "10:00", displayOrder: 2 },
        { id: "c", title: "C", capacity: 1, slotDate: "2026-12-06", displayOrder: 1 },
      ],
      []
    );
    expect(sections.map((s) => s.date)).toEqual(["2026-12-06", "2026-12-07"]);
    expect(sections[0].slots.map((s) => s.slot.id)).toEqual(["c", "a"]);
    const html = buildSignupReportHtml({
      event, slots: sections.flatMap((s) => s.slots.map((x) => x.slot)), signups: [],
      siteName: "ManyMano", eventUrl: "https://example.com/events/x", nonce: "n",
    });
    expect(html).toContain("Sun, Dec 6 – Mon, Dec 7, 2026");
  });

  it("caps blank rows and skips them for unlimited slots", () => {
    const html = buildSignupReportHtml({
      event,
      slots: [
        { id: "big", title: "Big", capacity: 100 },
        { id: "inf", title: "Any", capacity: -1 },
      ],
      signups: [],
      siteName: "ManyMano",
      eventUrl: "https://example.com/events/x",
      nonce: "n",
    });
    expect(html.match(/<td class="name">Available<\/td>/g)?.length).toBe(MAX_BLANK_ROWS);
    expect(html).toContain(`+ ${100 - MAX_BLANK_ROWS} more open spots`);
    expect(html).toContain("No signups yet");
    expect(html).toContain("0 signups");
  });
});
