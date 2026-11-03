// Route-level coverage for the read/write paths that now run concurrently or
// as single D1 batches: the event page loader, poll votes and proposals,
// vote/event deletion, poll creation, the CSV export, pruning and the
// reminder scan. Real loaders/actions against the in-memory SQLite D1.

import { beforeEach, describe, expect, it } from "vitest";
import { action, loader } from "~/routes/events.$id";
import { action as createPollAction } from "~/routes/create.poll";
import { loader as exportLoader } from "~/routes/events.$id.export";
import { sha256Hex } from "~/utils/auth";
import { getDb } from "~/db";
import { pruneExpiredEvents } from "~/utils/retention";
import { collectReminderTargets } from "~/utils/reminders";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { SITE_URL, postForm, routeContext, testEnv } from "./helpers/route-harness";

type Unwrapped = { status: number; body: Record<string, any>; response: Response | null };

function unwrap(res: unknown): Unwrapped {
  if (res instanceof Response) return { status: res.status, body: {}, response: res };
  const r = res as { data: Record<string, any>; init?: { status?: number } | null };
  return { status: r.init?.status ?? 200, body: r.data, response: null };
}

let db: SqliteD1;
let ip = 0;
const headers = () => ({ origin: SITE_URL, "cf-connecting-ip": `198.18.0.${++ip}` });

beforeEach(() => {
  db = createSqliteD1();
});

const FUTURE = "2099-06-01";
const nowIso = () => new Date().toISOString();

function addEvent(id: string, type: "SIGNUP_SHEET" | "TIME_POLL", adminHash: string, extra: { createdAt?: string; status?: string; winning?: string | null; eventDate?: string | null } = {}) {
  const created = extra.createdAt ?? nowIso();
  db.sqlite
    .prepare(
      `INSERT INTO events (id, type, title, event_date, organizer_name, organizer_email, admin_token, status, settings, winning_slot_id, timezone, created_at, updated_at)
       VALUES (?, ?, 'Picnic', ?, 'Sam', '', ?, ?, '{}', ?, 'UTC', ?, ?)`
    )
    .run(id, type, extra.eventDate === undefined ? FUTURE : extra.eventDate, adminHash, extra.status ?? "OPEN", extra.winning ?? null, created, created);
}

function addSlot(id: string, eventId: string, order: number, slotDate: string | null = FUTURE, startTime: string | null = null) {
  db.sqlite
    .prepare(
      `INSERT INTO event_slots (id, event_id, title, slot_date, start_time, capacity, display_order) VALUES (?, ?, ?, ?, ?, 999, ?)`
    )
    .run(id, eventId, `Option ${id}`, slotDate, startTime, order);
}

async function addVote(id: string, eventId: string, name: string, token: string, responses: Record<string, string>, email: string | null = null) {
  db.sqlite
    .prepare(
      `INSERT INTO poll_votes (id, event_id, participant_name, participant_email, edit_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, eventId, name, email, await sha256Hex(token), nowIso(), nowIso());
  for (const [slotId, response] of Object.entries(responses)) {
    db.sqlite
      .prepare(`INSERT INTO poll_vote_entries (id, poll_vote_id, slot_id, response) VALUES (?, ?, ?, ?)`)
      .run(`${id}_${slotId}`, id, slotId, response);
  }
}

async function addSignup(id: string, eventId: string, slotId: string, token: string, status = "CONFIRMED") {
  db.sqlite
    .prepare(
      `INSERT INTO signups (id, slot_id, event_id, participant_name, participant_email, edit_token, custom_fields, status, created_at)
       VALUES (?, ?, ?, ?, 'p@example.com', ?, '{}', ?, ?)`
    )
    .run(id, slotId, eventId, `Name ${id}`, await sha256Hex(token), status, nowIso());
}

const count = (sql: string, ...params: unknown[]) =>
  (db.sqlite.prepare(sql).get(...(params as never[])) as { n: number }).n;

async function runLoader(id: string, query = "", reqHeaders: Record<string, string> = {}) {
  const request = new Request(`${SITE_URL}/events/${id}${query}`, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", ...reqHeaders } });
  return unwrap(await loader({ request, params: { id }, context: routeContext(testEnv(db)), url: new URL(request.url) } as never));
}

async function runAction(id: string, fields: Record<string, string>) {
  const request = postForm(`/events/${id}`, fields, headers());
  return unwrap(await action({ request, params: { id }, context: routeContext(testEnv(db)), url: new URL(request.url) } as never));
}

async function seedPoll(id: string, slots: number) {
  const admin = `adm_${id}`;
  addEvent(id, "TIME_POLL", await sha256Hex(admin));
  for (let i = 0; i < slots; i++) addSlot(`${id}_s${i}`, id, i, FUTURE, `${String(8 + (i % 12)).padStart(2, "0")}:${i < 12 ? "00" : "30"}`);
  return admin;
}

describe("event page loader", () => {
  it("returns poll votes and tallies scoped to this event only", async () => {
    await seedPoll("pollA", 2);
    await seedPoll("pollB", 2);
    await addVote("va1", "pollA", "Ann", "t1", { pollA_s0: "YES", pollA_s1: "MAYBE" });
    await addVote("va2", "pollA", "Bo", "t2", { pollA_s0: "YES" });
    await addVote("vb1", "pollB", "Cy", "t3", { pollB_s0: "YES" });

    const { status, body } = await runLoader("pollA");
    expect(status).toBe(200);
    expect(body.pollData.votes.map((v: { participantName: string }) => v.participantName).sort()).toEqual(["Ann", "Bo"]);
    expect(body.pollData.tallies).toEqual({ pollA_s0: { yes: 2, maybe: 0 }, pollA_s1: { yes: 0, maybe: 1 } });
    expect(body.signups).toEqual([]);
    expect(body.viewCount).toBe(1);
  });

  it("returns only confirmed signups for a sheet, without emails for guests", async () => {
    addEvent("sheet1", "SIGNUP_SHEET", await sha256Hex("adm"));
    addSlot("sh_s0", "sheet1", 0);
    await addSignup("su1", "sheet1", "sh_s0", "x1");
    await addSignup("su2", "sheet1", "sh_s0", "x2", "CANCELLED");

    const { body } = await runLoader("sheet1");
    expect(body.slots.map((s: { id: string }) => s.id)).toEqual(["sh_s0"]);
    expect(body.signups.map((s: { id: string }) => s.id)).toEqual(["su1"]);
    expect(body.signups[0].participantEmail).toBeNull();
    expect(body.pollData).toBeNull();
  });

  it("resolves a vote cancel token and rejects an unknown one", async () => {
    await seedPoll("pollC", 1);
    await addVote("vc1", "pollC", "Dee", "vote-token", { pollC_s0: "YES" });

    const ok = await runLoader("pollC", "?cancel_token=vote-token");
    expect(ok.body.pendingCancel).toEqual({ kind: "vote", name: "Dee", voteId: "vc1" });

    const bad = await runLoader("pollC", "?cancel_token=nope");
    expect(bad.response?.headers.get("Location")).toContain("cancel_error=1");
  });

  it("redirects a valid ?admin= link to the clean URL with the cookie", async () => {
    const admin = await seedPoll("pollD", 1);
    const res = await runLoader("pollD", `?admin=${admin}`);
    expect(res.status).toBe(302);
    expect(res.response?.headers.get("Location")).toBe(`${SITE_URL}/events/pollD`);
    expect(res.response?.headers.get("Set-Cookie")).toContain("mm_admin_pollD=");
  });
});

describe("poll votes", () => {
  it("records a new vote with every option in batched inserts", async () => {
    await seedPoll("pollE", 25); // > one 20-row entry insert
    const fields: Record<string, string> = { intent: "vote_poll", participantName: "Eve" };
    for (let i = 0; i < 25; i++) fields[`slot_pollE_s${i}`] = i % 2 ? "MAYBE" : "YES";
    const res = await runAction("pollE", fields);
    expect(res.body.success).toBe(true);
    expect(res.body.voteToken).toBeTruthy();
    expect(count("SELECT COUNT(*) AS n FROM poll_vote_entries WHERE poll_vote_id = ?", res.body.voteId)).toBe(25);
    expect(count("SELECT COUNT(*) AS n FROM poll_vote_entries WHERE response = 'YES'")).toBe(13);
  });

  it("updates its own vote in place, replacing open entries", async () => {
    await seedPoll("pollF", 3);
    await addVote("vf1", "pollF", "Fay", "own-token", { pollF_s0: "YES", pollF_s1: "YES" });
    const res = await runAction("pollF", {
      intent: "vote_poll",
      participantName: "Fay R.",
      clientVoteId: "vf1",
      clientVoteToken: "own-token",
      slot_pollF_s2: "MAYBE",
    });
    expect(res.body.success).toBe(true);
    expect(res.body.voteId).toBe("vf1");
    const rows = db.sqlite.prepare("SELECT slot_id, response FROM poll_vote_entries WHERE poll_vote_id = 'vf1'").all();
    expect(rows).toEqual([{ slot_id: "pollF_s2", response: "MAYBE" }]);
    expect(db.sqlite.prepare("SELECT participant_name AS n FROM poll_votes WHERE id = 'vf1'").get()).toEqual({ n: "Fay R." });
  });

  it("rejects a taken name without writing anything", async () => {
    await seedPoll("pollG", 1);
    await addVote("vg1", "pollG", "Gus", "g", { pollG_s0: "YES" });
    const res = await runAction("pollG", { intent: "vote_poll", participantName: "gus", slot_pollG_s0: "YES" });
    expect(res.status).toBe(409);
    expect(count("SELECT COUNT(*) AS n FROM poll_votes")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM poll_vote_entries")).toBe(1);
  });

  it("adds a proposed time as YES alongside the submitted matrix", async () => {
    await seedPoll("pollH", 2);
    const res = await runAction("pollH", {
      intent: "propose_slot",
      participantName: "Hal",
      slotDate: "2099-07-01",
      slotStartTime: "10:00",
      slot_pollH_s0: "YES",
      slot_pollH_s1: "NO",
    });
    expect(res.body.success).toBe(true);
    const entries = db.sqlite
      .prepare("SELECT slot_id, response FROM poll_vote_entries WHERE poll_vote_id = ? ORDER BY slot_id")
      .all(res.body.voteId);
    expect(entries).toEqual([
      { slot_id: "pollH_s0", response: "YES" },
      { slot_id: res.body.proposedSlotId, response: "YES" },
    ].sort((a, b) => a.slot_id.localeCompare(b.slot_id)));
  });

  it("deletes a vote and its entries with the owner token", async () => {
    await seedPoll("pollI", 2);
    await addVote("vi1", "pollI", "Ivy", "ivy-token", { pollI_s0: "YES", pollI_s1: "MAYBE" });
    const res = await runAction("pollI", { intent: "delete_poll_vote", voteId: "vi1", editToken: "ivy-token" });
    expect(res.body.success).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM poll_votes")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM poll_vote_entries")).toBe(0);
  });

  it("cancels a vote by emailed token", async () => {
    await seedPoll("pollJ", 1);
    await addVote("vj1", "pollJ", "Jo", "jo-token", { pollJ_s0: "YES" });
    const res = await runAction("pollJ", { intent: "cancel_by_token", cancel_token: "jo-token" });
    expect(res.response?.headers.get("Location")).toContain("cancelled=1");
    expect(count("SELECT COUNT(*) AS n FROM poll_votes")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM poll_vote_entries")).toBe(0);
  });
});

describe("organizer deletes", () => {
  it("delete_event removes the event and every child row", async () => {
    const admin = await seedPoll("pollK", 2);
    await addVote("vk1", "pollK", "Kai", "k", { pollK_s0: "YES" });
    await seedPoll("keepMe", 1);
    const res = await runAction("pollK", { intent: "delete_event", adminToken: admin });
    expect(res.response?.headers.get("Location")).toBe("/?deleted=1");
    expect(count("SELECT COUNT(*) AS n FROM events WHERE id = 'pollK'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM event_slots WHERE event_id = 'pollK'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM poll_votes")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM poll_vote_entries")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM events WHERE id = 'keepMe'")).toBe(1);
  });

  it("delete_slot removes the option, its entries, and reopens a finalized winner", async () => {
    const admin = await seedPoll("pollL", 2);
    db.sqlite.prepare("UPDATE events SET winning_slot_id = 'pollL_s0' WHERE id = 'pollL'").run();
    await addVote("vl1", "pollL", "Lu", "l", { pollL_s0: "YES", pollL_s1: "YES" });
    const res = await runAction("pollL", { intent: "delete_slot", slotId: "pollL_s0", adminToken: admin });
    expect(res.body.success).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM event_slots WHERE id = 'pollL_s0'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM poll_vote_entries")).toBe(1);
    expect(db.sqlite.prepare("SELECT winning_slot_id AS w, status FROM events WHERE id = 'pollL'").get()).toEqual({ w: null, status: "OPEN" });
  });
});

describe("poll creation", () => {
  it("writes the event and all options in one batch", async () => {
    const body = new FormData();
    for (const [k, v] of Object.entries({
      title: "Team sync",
      organizerName: "Sam",
      organizerEmail: "sam@example.com",
      timezone: "UTC",
      durationMinutes: "60",
    })) body.set(k, v);
    for (let i = 0; i < 12; i++) {
      body.append("slotDate", `2099-08-${String(i + 1).padStart(2, "0")}`);
      body.append("slotStartTime", "09:00");
      body.append("slotEndTime", "");
      body.append("slotTitle", "");
    }
    const request = new Request(`${SITE_URL}/create/poll`, { method: "POST", body, headers: headers() });
    const res = unwrap(await createPollAction({ request, params: {}, context: routeContext(testEnv(db)) } as never));
    expect(res.status).toBe(302);
    const id = new URL(res.response!.headers.get("Location")!, SITE_URL).pathname.split("/").pop()!;
    expect(count("SELECT COUNT(*) AS n FROM events WHERE id = ?", id)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM event_slots WHERE event_id = ?", id)).toBe(12);
  });
});

describe("CSV export", () => {
  it("exports poll responses for this event's votes only", async () => {
    const admin = await seedPoll("pollM", 2);
    await seedPoll("pollN", 1);
    await addVote("vm1", "pollM", "Mo", "m", { pollM_s1: "YES" });
    await addVote("vn1", "pollN", "Ned", "n", { pollN_s0: "YES" });
    const request = new Request(`${SITE_URL}/events/pollM/export?admin=${admin}`, { headers: headers() });
    const res = (await exportLoader({ request, params: { id: "pollM" }, context: routeContext(testEnv(db)) } as never)) as Response;
    const csv = await res.text();
    const rows = csv.trim().split(/\r?\n/);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("Mo");
    expect(rows[1]).toMatch(/"?NO"?,"?YES"?/);
    expect(csv).not.toContain("Ned");
  });
});

describe("pruneExpiredEvents", () => {
  it("removes an expired event with all its children in one batch", async () => {
    const old = new Date(Date.now() - 400 * 86400_000).toISOString();
    addEvent("old1", "TIME_POLL", "x", { createdAt: old });
    addSlot("old1_s0", "old1", 0);
    await addVote("vo1", "old1", "Old", "o", { old1_s0: "YES" });
    await seedPoll("fresh", 1);
    expect(await pruneExpiredEvents(getDb(db.d1), new Date(), 365)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM events")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM poll_votes")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM poll_vote_entries")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM event_slots WHERE event_id = 'old1'")).toBe(0);
  });
});

describe("collectReminderTargets", () => {
  it("builds sheet and finalized-poll targets from set-based reads", async () => {
    const day = "2099-03-10";
    // Single-day sheet on the day, one multi-day sheet with a slot that day,
    // and an unrelated sheet whose signups must not leak in.
    addEvent("rs1", "SIGNUP_SHEET", "x", { eventDate: day });
    addSlot("rs1_b", "rs1", 1, null, "10:00");
    addSlot("rs1_a", "rs1", 0, null, "09:00");
    await addSignup("rsu1", "rs1", "rs1_a", "a");
    await addSignup("rsu2", "rs1", "rs1_a", "b", "CANCELLED");
    addEvent("rs2", "SIGNUP_SHEET", "x", { eventDate: "2099-03-09" });
    addSlot("rs2_d1", "rs2", 0, "2099-03-09");
    addSlot("rs2_d2", "rs2", 1, day);
    await addSignup("rsu3", "rs2", "rs2_d2", "c");
    addEvent("other", "SIGNUP_SHEET", "x", { eventDate: "2099-04-01" });
    addSlot("other_s", "other", 0, null);
    await addSignup("rsu4", "other", "other_s", "d");
    // Finalized poll won on the day; another finalized on a different day.
    addEvent("fp1", "TIME_POLL", "x", { status: "FINALIZED", winning: "fp1_w" });
    addSlot("fp1_w", "fp1", 0, day, "14:00");
    await addVote("fv1", "fp1", "Voter", "v", { fp1_w: "YES" }, "v@example.com");
    addEvent("fp2", "TIME_POLL", "x", { status: "FINALIZED", winning: "fp2_w" });
    addSlot("fp2_w", "fp2", 0, "2099-03-11");

    const targets = await collectReminderTargets(getDb(db.d1), day, 365);
    const byId = Object.fromEntries(targets.map((t) => [t.event.id, t]));
    expect(Object.keys(byId).sort()).toEqual(["fp1", "rs1", "rs2"]);

    const rs1 = byId.rs1 as Extract<(typeof targets)[number], { kind: "signup_sheet" }>;
    expect(rs1.slots.map((s) => s.id)).toEqual(["rs1_a", "rs1_b"]); // display order
    expect(rs1.slots[0].signups).toEqual([{ name: "Name rsu1", email: "p@example.com" }]);
    expect(rs1.slots[1].signups).toEqual([]);

    const rs2 = byId.rs2 as Extract<(typeof targets)[number], { kind: "signup_sheet" }>;
    expect(rs2.slots.map((s) => s.id)).toEqual(["rs2_d2"]);
    expect(rs2.slots[0].signups.map((s) => s.name)).toEqual(["Name rsu3"]);

    const fp1 = byId.fp1 as Extract<(typeof targets)[number], { kind: "finalized_meeting" }>;
    expect(fp1.winningSlot.id).toBe("fp1_w");
    expect(fp1.voters).toEqual([{ name: "Voter", email: "v@example.com" }]);
  });
});
