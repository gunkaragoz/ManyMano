import { describe, expect, it } from "vitest";
import { events, eventSlots } from "~/db";
import { loadCreatePrefill, loadSourceEvent } from "~/utils/prefill.server";
import { writeDateSpec } from "~/utils/recurrence";

// A fake of the few Drizzle calls the loader makes. It records the columns
// each query selects, so the tests can prove what is (not) read.
function fakeDb(eventRow: Record<string, unknown> | null, slotRows: Array<Record<string, unknown>>, fail = false) {
  const selects: Array<{ table: unknown; columns: string[] }> = [];
  const db = {
    select(columns: Record<string, unknown>) {
      return {
        from(table: unknown) {
          selects.push({ table, columns: Object.keys(columns) });
          const rows = table === events ? (eventRow ? [eventRow] : []) : slotRows;
          const result = () => (fail ? Promise.reject(new Error("D1 unavailable")) : Promise.resolve(rows));
          const query = {
            where: () => query,
            limit: () => result(),
            then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => result().then(ok, err),
          };
          return query;
        },
      };
    },
  };
  return { db, selects };
}

const NOW = new Date("2026-09-25T12:00:00Z");

const sheetRow = {
  id: "Sheet12345",
  type: "SIGNUP_SHEET",
  title: "Book fair",
  description: "Help",
  location: "Library",
  eventDate: "2026-11-16",
  timezone: "America/New_York",
  durationMinutes: null,
  settings: writeDateSpec(null, { mode: "range", end: "2026-11-17" }),
  createdAt: "2026-09-01T00:00:00Z",
};
const sheetSlots = ["2026-11-16", "2026-11-17"].map((d, i) => ({
  id: `s${i}`, title: "Cashier", shiftName: "Sales", capacity: 2, slotDate: d, startTime: "08:00", endTime: "15:00", displayOrder: i,
}));

const url = (q: string) => new URL(`https://example.com/create/signup?${q}`);

describe("loadCreatePrefill", () => {
  it("returns none without parameters and never touches the DB", async () => {
    const r = await loadCreatePrefill("signup", url(""), { db: () => { throw new Error("no db"); }, retentionDays: 365, now: NOW });
    expect(r).toEqual({ status: "none" });
  });

  it("builds a template prefill without the DB", async () => {
    const r = await loadCreatePrefill("signup", url("template=potluck"), { db: () => { throw new Error("no db"); }, retentionDays: 365 });
    expect(r).toMatchObject({ status: "ready", prefill: { source: { kind: "template", slug: "potluck" } } });
  });

  it("redirects a template meant for the other flow, keeping only that parameter", async () => {
    const r = await loadCreatePrefill("signup", url("template=book-club&utm=x"), { db: () => null, retentionDays: 365 });
    expect(r).toEqual({ redirect: "/create/poll?template=book-club" });
  });

  it("reports an unknown template as missing", async () => {
    const r = await loadCreatePrefill("poll", url("template=nope"), { db: () => null, retentionDays: 365 });
    expect(r).toEqual({ status: "missing", source: "template" });
  });

  it("prefers ?from= over ?template= and never falls back", async () => {
    const { db } = fakeDb(null, []);
    const r = await loadCreatePrefill("signup", url("from=Gone123456&template=potluck"), { db: () => db, retentionDays: 365, now: NOW });
    expect(r).toEqual({ status: "missing", source: "clone" });
  });

  it("copies a sheet", async () => {
    const { db } = fakeDb(sheetRow, sheetSlots);
    const r = await loadCreatePrefill("signup", url("from=Sheet12345"), { db: () => db, retentionDays: 365, now: NOW });
    expect(r).toMatchObject({ status: "ready", prefill: { source: { kind: "clone", eventId: "Sheet12345" }, dates: { mode: "range", spanDays: 2 } } });
  });

  it("redirects a sheet opened on the poll page", async () => {
    const { db } = fakeDb(sheetRow, sheetSlots);
    const r = await loadCreatePrefill("poll", url("from=Sheet12345&template=x"), { db: () => db, retentionDays: 365, now: NOW });
    expect(r).toEqual({ redirect: "/create/signup?from=Sheet12345" });
  });

  it("treats an expired event still in storage as missing", async () => {
    const old = { ...sheetRow, createdAt: "2024-01-01T00:00:00Z", eventDate: "2024-02-01", settings: "{}" };
    const { db } = fakeDb(old, sheetSlots.map((s) => ({ ...s, slotDate: null })));
    const r = await loadCreatePrefill("signup", url("from=Sheet12345"), { db: () => db, retentionDays: 365, now: NOW });
    expect(r).toEqual({ status: "missing", source: "clone" });
  });

  it("keeps a running series alive through its last date", async () => {
    const running = { ...sheetRow, createdAt: "2025-06-01T00:00:00Z" };
    const { db } = fakeDb(running, sheetSlots);
    const r = await loadCreatePrefill("signup", url("from=Sheet12345"), { db: () => db, retentionDays: 365, now: NOW });
    expect(r).toMatchObject({ status: "ready" });
  });

  it("reports an unsupported structure with its reason and event", async () => {
    const { db } = fakeDb(sheetRow, [sheetSlots[0], { ...sheetSlots[1], capacity: 9 }]);
    const r = await loadCreatePrefill("signup", url("from=Sheet12345"), { db: () => db, retentionDays: 365, now: NOW });
    expect(r).toMatchObject({ status: "unsupported", eventId: "Sheet12345" });
  });

  it("propagates DB failures instead of calling the event missing", async () => {
    const { db } = fakeDb(sheetRow, sheetSlots, true);
    await expect(loadCreatePrefill("signup", url("from=Sheet12345"), { db: () => db, retentionDays: 365, now: NOW })).rejects.toThrow(/D1/);
  });

  it("rejects malformed ids without a query", async () => {
    const { db, selects } = fakeDb(sheetRow, sheetSlots);
    const r = await loadCreatePrefill("signup", url(`from=${encodeURIComponent("x'; drop")}`), { db: () => db, retentionDays: 365, now: NOW });
    expect(r).toEqual({ status: "missing", source: "clone" });
    expect(selects).toHaveLength(0);
  });
});

describe("loadSourceEvent projection", () => {
  it("selects only public structure — no organizer, token, status, or responses", async () => {
    const { db, selects } = fakeDb(sheetRow, sheetSlots);
    const source = await loadSourceEvent(db, "Sheet12345", 365, NOW);
    expect(source).not.toBeNull();
    const eventCols = selects.find((s) => s.table === events)!.columns;
    const slotCols = selects.find((s) => s.table === eventSlots)!.columns;
    for (const banned of ["organizerName", "organizerEmail", "adminToken", "status", "winningSlotId"]) {
      expect(eventCols).not.toContain(banned);
    }
    expect(selects.every((s) => s.table === events || s.table === eventSlots)).toBe(true);
    expect(slotCols.sort()).toEqual(["capacity", "displayOrder", "endTime", "id", "shiftName", "slotDate", "startTime", "title"]);
    expect(Object.keys(source!.event)).not.toContain("createdAt");
  });
});
