import { describe, expect, it } from "vitest";
import { readPublicEvent } from "~/utils/event-read";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";

const NOW = new Date("2026-09-27T12:00:00Z");
const OPTS = { siteUrl: "https://example.com", retentionDays: 90, now: NOW };

function addEvent(
  db: SqliteD1,
  e: { id: string; type?: string; status?: string; eventDate?: string | null; createdAt?: string; winning?: string | null }
) {
  db.sqlite
    .prepare(
      `INSERT INTO events (id, type, title, event_date, location, organizer_name, organizer_email, admin_token, status, settings, winning_slot_id, timezone, duration_minutes, created_at, updated_at)
       VALUES (?, ?, 'Picnic', ?, 'Park', 'Secret Organizer', 'org@secret.test', 'hash-secret', ?, '{"private":1}', ?, 'UTC', ?, ?, ?)`
    )
    .run(
      e.id,
      e.type ?? "SIGNUP_SHEET",
      e.eventDate ?? null,
      e.status ?? "OPEN",
      e.winning ?? null,
      e.type === "TIME_POLL" ? 60 : null,
      e.createdAt ?? NOW.toISOString(),
      e.createdAt ?? NOW.toISOString()
    );
}

function addSlot(
  db: SqliteD1,
  s: { id: string; eventId: string; order: number; capacity?: number; date?: string | null; start?: string | null; end?: string | null }
) {
  db.sqlite
    .prepare(
      `INSERT INTO event_slots (id, event_id, title, slot_date, start_time, end_time, capacity, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(s.id, s.eventId, `Slot ${s.id}`, s.date ?? null, s.start ?? null, s.end ?? null, s.capacity ?? 2, s.order);
}

function addSignup(db: SqliteD1, id: string, eventId: string, slotId: string, status = "CONFIRMED") {
  db.sqlite
    .prepare(
      `INSERT INTO signups (id, slot_id, event_id, participant_name, participant_email, edit_token, status, created_at)
       VALUES (?, ?, ?, 'Pat Participant', 'pat@secret.test', 'tok-secret', ?, ?)`
    )
    .run(id, slotId, eventId, status, NOW.toISOString());
}

function addVote(db: SqliteD1, id: string, eventId: string, responses: Record<string, string>) {
  db.sqlite
    .prepare(
      `INSERT INTO poll_votes (id, event_id, participant_name, participant_email, edit_token, created_at, updated_at)
       VALUES (?, ?, 'Val Voter', 'val@secret.test', 'tok-secret', ?, ?)`
    )
    .run(id, eventId, NOW.toISOString(), NOW.toISOString());
  for (const [slotId, response] of Object.entries(responses)) {
    db.sqlite
      .prepare(`INSERT INTO poll_vote_entries (id, poll_vote_id, slot_id, response) VALUES (?, ?, ?, ?)`)
      .run(`${id}-${slotId}`, id, slotId, response);
  }
}

async function read(db: SqliteD1, id: string, opts = OPTS) {
  const r = await readPublicEvent(db.d1, id, opts);
  if (!r.ok) throw new Error(r.error);
  return r.summary;
}

describe("readPublicEvent", () => {
  it("counts confirmed sign-ups per task and leaves cancelled ones out", async () => {
    const db = createSqliteD1();
    addEvent(db, { id: "e1", eventDate: "2026-10-10" });
    addSlot(db, { id: "a", eventId: "e1", order: 0, capacity: 3 });
    addSlot(db, { id: "b", eventId: "e1", order: 1, capacity: 0 }); // unlimited
    addSignup(db, "s1", "e1", "a");
    addSignup(db, "s2", "e1", "a");
    addSignup(db, "s3", "e1", "a", "CANCELLED");
    addSignup(db, "s4", "e1", "b");
    const s = await read(db, "e1");
    expect(s).toMatchObject({
      eventId: "e1",
      publicUrl: "https://example.com/events/e1",
      type: "signup_sheet",
      status: "open",
      date: "2026-10-10",
    });
    expect(s.slots?.map((x) => [x.id, x.capacity, x.filled])).toEqual([
      ["a", 3, 2],
      ["b", null, 1],
    ]);
  });

  it("tallies poll answers separately and doesn't count missing answers as no", async () => {
    const db = createSqliteD1();
    addEvent(db, { id: "p1", type: "TIME_POLL", eventDate: "2026-10-10", status: "FINALIZED", winning: "y" });
    addSlot(db, { id: "y", eventId: "p1", order: 1, date: "2026-10-11", start: "09:00", end: "10:00" });
    addSlot(db, { id: "x", eventId: "p1", order: 0, date: "2026-10-10", start: "09:00", end: "10:00" });
    addVote(db, "v1", "p1", { x: "YES", y: "MAYBE" });
    addVote(db, "v2", "p1", { x: "NO" }); // no answer for y
    addVote(db, "v3", "p1", { x: "YES", y: "YES" });
    const s = await read(db, "p1");
    expect(s).toMatchObject({ type: "poll", status: "finalized", winningOptionId: "y", durationMinutes: 60 });
    expect(s.options?.map((o) => [o.id, o.yes, o.maybe, o.no])).toEqual([
      ["x", 2, 0, 1],
      ["y", 1, 1, 0],
    ]);
  });

  it("marks closed events", async () => {
    const db = createSqliteD1();
    addEvent(db, { id: "c1", status: "CLOSED" });
    addSlot(db, { id: "a", eventId: "c1", order: 0 });
    expect((await read(db, "c1")).status).toBe("closed");

    addEvent(db, { id: "c2", eventDate: "2026-09-20" }); // already happened
    addSlot(db, { id: "b", eventId: "c2", order: 0 });
    expect((await read(db, "c2")).status).toBe("closed");
  });

  it("reads large web-made multi-date sheets in full", async () => {
    const db = createSqliteD1();
    addEvent(db, { id: "m1", eventDate: "2026-10-01" });
    for (let i = 0; i < 300; i++) {
      addSlot(db, { id: `s${i}`, eventId: "m1", order: i, date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` });
    }
    const s = await read(db, "m1");
    expect(s.slots).toHaveLength(300);
    expect(s.slots?.[5].date).toBe("2026-10-06");
  });

  it("refuses rather than truncating oversized events", async () => {
    const db = createSqliteD1();
    addEvent(db, { id: "big" });
    for (let i = 0; i < 301; i++) addSlot(db, { id: `s${i}`, eventId: "big", order: i });
    const r = await readPublicEvent(db.d1, "big", OPTS);
    expect(r.ok).toBe(false);
  });

  it("follows retention: sheets live until their last dated slot", async () => {
    const db = createSqliteD1();
    const old = "2026-05-01T00:00:00Z"; // > 90 days before NOW
    addEvent(db, { id: "gone", createdAt: old });
    addSlot(db, { id: "a", eventId: "gone", order: 0 });
    addEvent(db, { id: "kept", createdAt: old });
    addSlot(db, { id: "b", eventId: "kept", order: 0, date: "2026-09-01" });
    expect((await readPublicEvent(db.d1, "gone", OPTS)).ok).toBe(false);
    expect((await readPublicEvent(db.d1, "kept", OPTS)).ok).toBe(true);
    expect((await readPublicEvent(db.d1, "nope", OPTS)).ok).toBe(false);
  });

  it("never returns names, emails, tokens or private settings", async () => {
    const db = createSqliteD1();
    addEvent(db, { id: "e1", type: "TIME_POLL" });
    addSlot(db, { id: "x", eventId: "e1", order: 0, date: "2026-10-10", start: "09:00", end: "10:00" });
    addVote(db, "v1", "e1", { x: "YES" });
    addEvent(db, { id: "e2" });
    addSlot(db, { id: "a", eventId: "e2", order: 0 });
    addSignup(db, "s1", "e2", "a");
    for (const id of ["e1", "e2"]) {
      const json = JSON.stringify(await read(db, id));
      for (const secret of ["secret", "Organizer", "Participant", "Voter", "private", "hash", "tok-"]) {
        expect(json).not.toContain(secret);
      }
    }
  });

  it("does not write anything", async () => {
    const db = createSqliteD1();
    addEvent(db, { id: "e1", createdAt: "2026-01-01T00:00:00Z" }); // expired
    addEvent(db, { id: "e2" });
    db.failOn = /^\s*(insert|update|delete)/i;
    await readPublicEvent(db.d1, "e1", OPTS);
    await readPublicEvent(db.d1, "e2", OPTS);
    const n = db.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    expect(n.n).toBe(2);
  });
});
