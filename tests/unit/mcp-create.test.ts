import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SLOT_INSERT_BATCH,
  insertEvent,
  normalizePollInput,
  normalizeSignupInput,
  type NormalizedEvent,
  type PollInput,
  type SignupSheetInput,
} from "~/utils/event-create";
import { sha256Hex } from "~/utils/auth";
import { getDb, eventSlots } from "~/db";
import { createSqliteD1 } from "./helpers/sqlite-d1";

// Noon UTC; New York is 08:00 the same day.
const NOW = new Date("2026-09-27T12:00:00Z");

const sheet = (over: Partial<SignupSheetInput> = {}): SignupSheetInput => ({
  title: "Potluck",
  timezone: "America/New_York",
  organizerName: "Sam",
  date: "2026-10-10",
  tasks: [{ title: "Drinks", capacity: 2 }],
  ...over,
});

const poll = (over: Partial<PollInput> = {}): PollInput => ({
  title: "Standup",
  timezone: "Europe/London",
  organizerName: "Sam",
  durationMinutes: 30,
  options: [{ date: "2026-10-10", startTime: "09:00" }],
  ...over,
});

function ok(r: ReturnType<typeof normalizeSignupInput>): NormalizedEvent {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.event;
}

function err(r: ReturnType<typeof normalizeSignupInput>): string {
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

describe("normalizeSignupInput", () => {
  it("builds a single-date sheet shaped like web-made ones", () => {
    const e = ok(
      normalizeSignupInput(
        sheet({
          title: "  Potluck  ",
          description: "  ",
          tasks: [
            { title: "Drinks", capacity: 2 },
            { title: "Setup", capacity: 3, startTime: "17:00", endTime: "18:30" },
          ],
        }),
        NOW
      )
    );
    expect(e).toMatchObject({
      type: "SIGNUP_SHEET",
      title: "Potluck",
      description: null,
      eventDate: "2026-10-10",
      timezone: "America/New_York",
      durationMinutes: null,
      settings: "{}",
    });
    expect(e.slots).toEqual([
      { title: "Drinks", slotDate: null, startTime: null, endTime: null, capacity: 2, displayOrder: 0 },
      { title: "Setup", slotDate: null, startTime: "17:00", endTime: "18:30", capacity: 3, displayOrder: 1 },
    ]);
  });

  it("allows an undated sheet without times", () => {
    const e = ok(normalizeSignupInput(sheet({ date: undefined }), NOW));
    expect(e.eventDate).toBeNull();
  });

  it("requires a date when tasks have times", () => {
    expect(
      err(normalizeSignupInput(sheet({ date: undefined, tasks: [{ title: "A", capacity: 1, startTime: "09:00", endTime: "10:00" }] }), NOW))
    ).toMatch(/need a date/);
  });

  it("rejects empty, overlong and missing text instead of trimming it away", () => {
    expect(err(normalizeSignupInput(sheet({ title: "   " }), NOW))).toMatch(/Title is required/);
    expect(err(normalizeSignupInput(sheet({ title: "x".repeat(201) }), NOW))).toMatch(/too long/);
    expect(err(normalizeSignupInput(sheet({ organizerName: "" }), NOW))).toMatch(/Organizer name/);
    expect(err(normalizeSignupInput(sheet({ tasks: [{ title: " ", capacity: 1 }] }), NOW))).toMatch(/Task 1 title/);
  });

  it("requires a real IANA timezone and never defaults to UTC", () => {
    expect(err(normalizeSignupInput(sheet({ timezone: "" }), NOW))).toMatch(/Timezone is required/);
    expect(err(normalizeSignupInput(sheet({ timezone: "Mars/Olympus" }), NOW))).toMatch(/not a valid/);
  });

  it("rejects fake and past dates on the event's own calendar", () => {
    expect(err(normalizeSignupInput(sheet({ date: "2026-02-30" }), NOW))).toMatch(/real date/);
    expect(err(normalizeSignupInput(sheet({ date: "10/10/2026" }), NOW))).toMatch(/real date/);
    expect(err(normalizeSignupInput(sheet({ date: "2026-09-26" }), NOW))).toMatch(/already passed/);
    // 12:00 UTC is still Sep 27 in New York, and already Sep 28 in Auckland.
    expect(normalizeSignupInput(sheet({ date: "2026-09-27" }), NOW).ok).toBe(true);
    expect(err(normalizeSignupInput(sheet({ date: "2026-09-27", timezone: "Pacific/Auckland" }), NOW))).toMatch(
      /already passed/
    );
  });

  it("checks capacity as a whole number in range, without clamping or coercion", () => {
    for (const capacity of [0, 1000, 2.5, -1]) {
      expect(err(normalizeSignupInput(sheet({ tasks: [{ title: "A", capacity }] }), NOW))).toMatch(/capacity/);
    }
    expect(
      err(normalizeSignupInput(sheet({ tasks: [{ title: "A", capacity: "3" as unknown as number }] }), NOW))
    ).toMatch(/capacity/);
  });

  it("checks task times", () => {
    const one = (t: Partial<SignupSheetInput["tasks"][number]>) =>
      normalizeSignupInput(sheet({ tasks: [{ title: "A", capacity: 1, ...t }] }), NOW);
    expect(err(one({ startTime: "09:00" }))).toMatch(/both startTime and endTime/);
    expect(err(one({ startTime: "9am", endTime: "10:00" }))).toMatch(/HH:MM/);
    expect(err(one({ startTime: "10:00", endTime: "10:00" }))).toMatch(/after startTime/);
    expect(err(one({ startTime: "22:00", endTime: "01:00" }))).toMatch(/overnight/);
  });

  it("rejects same-day shifts that already started", () => {
    // 08:00 in New York at NOW.
    const today = (startTime: string) =>
      normalizeSignupInput(
        sheet({ date: "2026-09-27", tasks: [{ title: "A", capacity: 1, startTime, endTime: "23:00" }] }),
        NOW
      );
    expect(err(today("07:30"))).toMatch(/already passed today/);
    expect(today("08:30").ok).toBe(true);
  });

  it("limits the number of tasks", () => {
    expect(err(normalizeSignupInput(sheet({ tasks: [] }), NOW))).toMatch(/at least 1/);
    const many = Array.from({ length: 32 }, (_, i) => ({ title: `T${i}`, capacity: 1 }));
    expect(err(normalizeSignupInput(sheet({ tasks: many }), NOW))).toMatch(/max 31/);
    expect(normalizeSignupInput(sheet({ tasks: many.slice(0, 31) }), NOW).ok).toBe(true);
  });
});

describe("normalizePollInput", () => {
  it("builds timed options with derived end times and web labels", () => {
    const e = ok(
      normalizePollInput(
        poll({
          options: [
            { date: "2026-10-12", startTime: "23:45" },
            { date: "2026-10-10", startTime: "09:00" },
          ],
        }),
        NOW
      )
    );
    expect(e).toMatchObject({ type: "TIME_POLL", durationMinutes: 30, eventDate: "2026-10-10", settings: "{}" });
    expect(e.slots[0]).toMatchObject({ slotDate: "2026-10-12", startTime: "23:45", endTime: "00:15", capacity: 999 });
    expect(e.slots[0].title).toBe("Mon, Oct 12 · 11:45 PM – 12:15 AM");
  });

  it("builds all-day options", () => {
    const e = ok(normalizePollInput(poll({ durationMinutes: undefined, allDay: true, options: [{ date: "2026-10-10" }] }), NOW));
    expect(e.durationMinutes).toBeNull();
    expect(e.slots[0]).toMatchObject({ startTime: null, endTime: null, title: "Sat, Oct 10 · All day" });
  });

  it("keeps all-day and timed modes apart", () => {
    expect(err(normalizePollInput(poll({ allDay: true }), NOW))).toMatch(/not both/);
    expect(err(normalizePollInput(poll({ durationMinutes: undefined }), NOW))).toMatch(/durationMinutes/);
    expect(
      err(normalizePollInput(poll({ durationMinutes: undefined, allDay: true, options: [{ date: "2026-10-10", startTime: "09:00" }] }), NOW))
    ).toMatch(/no startTime/);
    expect(err(normalizePollInput(poll({ options: [{ date: "2026-10-10" }] }), NOW))).toMatch(/HH:MM/);
  });

  it("bounds the duration", () => {
    for (const durationMinutes of [14, 1441, 30.5]) {
      expect(err(normalizePollInput(poll({ durationMinutes }), NOW))).toMatch(/durationMinutes/);
    }
    expect(normalizePollInput(poll({ durationMinutes: 1440 }), NOW).ok).toBe(true);
  });

  it("rejects duplicate options", () => {
    expect(
      err(normalizePollInput(poll({ options: [{ date: "2026-10-10", startTime: "09:00" }, { date: "2026-10-10", startTime: "09:00" }] }), NOW))
    ).toMatch(/already in the poll/);
    expect(
      err(normalizePollInput(poll({ durationMinutes: undefined, allDay: true, options: [{ date: "2026-10-10" }, { date: "2026-10-10" }] }), NOW))
    ).toMatch(/already in the poll/);
    // Same day, different times is fine.
    expect(
      normalizePollInput(poll({ options: [{ date: "2026-10-10", startTime: "09:00" }, { date: "2026-10-10", startTime: "10:00" }] }), NOW).ok
    ).toBe(true);
  });

  it("rejects passed same-day starts, measured across a DST change", () => {
    // Europe/London falls back on 2026-10-25 at 02:00 BST → 01:00 GMT.
    const dstNow = new Date("2026-10-25T01:30:00Z"); // 01:30 GMT, after the change
    const at = (startTime: string) =>
      normalizePollInput(poll({ options: [{ date: "2026-10-25", startTime }] }), dstNow);
    expect(err(at("01:00"))).toMatch(/already passed today/);
    expect(at("02:00").ok).toBe(true);
  });

  it("limits the number of options", () => {
    const many = Array.from({ length: 32 }, (_, i) => ({ date: "2026-10-10", startTime: `${String(i % 24).padStart(2, "0")}:${i < 24 ? "00" : "30"}` }));
    expect(err(normalizePollInput(poll({ options: many }), NOW))).toMatch(/max 31/);
  });
});

describe("insertEvent", () => {
  afterEach(() => vi.unstubAllGlobals());

  const bigSheet = () =>
    ok(
      normalizeSignupInput(
        sheet({ tasks: Array.from({ length: 31 }, (_, i) => ({ title: `Task ${i}`, capacity: 2 })) }),
        NOW
      )
    );

  it("stores the event with no email, a hashed token and every slot", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const db = createSqliteD1();
    const { eventId, adminToken } = await insertEvent(db.d1, bigSheet(), NOW);
    const row = db.sqlite.prepare("SELECT * FROM events WHERE id = ?").get(eventId) as Record<string, unknown>;
    expect(row.organizer_email).toBe("");
    expect(row.admin_token).toBe(await sha256Hex(adminToken));
    expect(row.admin_token).not.toBe(adminToken);
    expect(row.status).toBe("OPEN");
    const n = db.sqlite.prepare("SELECT COUNT(*) AS n FROM event_slots WHERE event_id = ?").get(eventId) as { n: number };
    expect(n.n).toBe(31);
    expect(fetchSpy).not.toHaveBeenCalled(); // no mail, no outside calls
  });

  it("keeps each slot insert under D1's 100 bound values", () => {
    const db = getDb(createSqliteD1().d1);
    const rows = Array.from({ length: SLOT_INSERT_BATCH }, (_, i) => ({
      id: `s${i}`,
      eventId: "e",
      title: "t",
      shiftName: null,
      slotDate: null,
      startTime: null,
      endTime: null,
      capacity: 1,
      displayOrder: i,
    }));
    const { params } = db.insert(eventSlots).values(rows).toSQL();
    expect(params.length).toBeLessThanOrEqual(100);
  });

  it("rolls back the whole event when any slot insert fails", async () => {
    const db = createSqliteD1();
    db.failOn = /insert into "event_slots"/i;
    await expect(insertEvent(db.d1, bigSheet(), NOW)).rejects.toThrow();
    const n = db.sqlite.prepare("SELECT (SELECT COUNT(*) FROM events) + (SELECT COUNT(*) FROM event_slots) AS n").get() as {
      n: number;
    };
    expect(n.n).toBe(0);
  });

  it("retries an event-ID collision with a new ID, and gives up after a few", async () => {
    const db = createSqliteD1();
    const event = bigSheet();
    await insertEvent(db.d1, event, NOW, { publicId: () => "taken", internalId: () => crypto.randomUUID(), secretToken: () => "t1" });

    const ids = ["taken", "fresh"];
    const second = await insertEvent(db.d1, event, NOW, {
      publicId: () => ids.shift() as string,
      internalId: () => crypto.randomUUID(),
      secretToken: () => "t2",
    });
    expect(second.eventId).toBe("fresh");

    await expect(
      insertEvent(db.d1, event, NOW, { publicId: () => "taken", internalId: () => crypto.randomUUID(), secretToken: () => "t3" })
    ).rejects.toThrow(/UNIQUE/);
    const n = db.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    expect(n.n).toBe(2);
  });
});
