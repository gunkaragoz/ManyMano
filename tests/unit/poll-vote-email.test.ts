// Organizer update emails for poll votes: new votes, edits, proposals and
// self-removals email the organizer; organizer actions and polls without an
// organizer email stay silent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "~/routes/events.$id";
import { sha256Hex } from "~/utils/auth";
import { buildPollVoteUpdateEmail } from "~/utils/poll-vote-email";
import { getSiteConfig } from "~/utils/site";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { SITE_URL, postForm, routeContext, testEnv } from "./helpers/route-harness";

let db: SqliteD1;
let sent: Array<{ to: string[]; subject: string; html: string }>;
let fetchMock: ReturnType<typeof vi.fn>;
let ip = 0;

async function post(id: string, fields: Record<string, string>) {
  const request = postForm(`/events/${id}`, fields, {
    origin: SITE_URL,
    "cf-connecting-ip": `198.51.100.${++ip}`,
  });
  return action({
    request,
    params: { id },
    context: routeContext(
      testEnv(db, { RESEND_API_KEY: "re_test", TURNSTILE_SECRET_KEY: "ts_secret", TURNSTILE_HOSTNAMES: "example.com" })
    ),
    url: new URL(request.url),
  } as never);
}

const ADMIN = "tok_poll_secret";

async function seedPoll(id: string, organizerEmail = "sam@example.com") {
  const now = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO events (id, type, title, event_date, organizer_name, organizer_email, admin_token, status, settings, timezone, created_at, updated_at)
       VALUES (?, 'TIME_POLL', 'Team <Lunch>', NULL, 'Sam', ?, ?, 'OPEN', '{}', 'UTC', ?, ?)`
    )
    .run(id, organizerEmail, await sha256Hex(ADMIN), now, now);
  const slot = db.sqlite.prepare(
    `INSERT INTO event_slots (id, event_id, title, slot_date, start_time, capacity, display_order) VALUES (?, ?, ?, ?, ?, 999, ?)`
  );
  slot.run(`${id}_a`, id, "Option A", "2099-06-01", "10:00", 0);
  slot.run(`${id}_b`, id, "Option B", "2099-06-02", null, 1);
}

async function addVote(id: string, eventId: string, name: string, token: string, email: string | null = null) {
  const now = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO poll_votes (id, event_id, participant_name, participant_email, edit_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, eventId, name, email, await sha256Hex(token), now, now);
  db.sqlite
    .prepare(`INSERT INTO poll_vote_entries (id, poll_vote_id, slot_id, response) VALUES (?, ?, ?, 'YES')`)
    .run(`${id}_e`, id, `${eventId}_a`);
}

const toOrganizer = () => sent.filter((m) => m.to.includes("sam@example.com"));

beforeEach(() => {
  db = createSqliteD1();
  sent = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const host = new URL(String(input instanceof Request ? input.url : input)).hostname;
    if (host === "challenges.cloudflare.com") {
      return Response.json({ success: true, action: "poll-vote", hostname: "example.com" });
    }
    if (host === "api.resend.com") {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "email_1" });
    }
    throw new Error(`unexpected fetch to ${host}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("organizer poll vote updates", () => {
  it("emails the organizer about a new vote with the voter's answers and tracks the send", async () => {
    await seedPoll("pv_new");
    const res = (await post("pv_new", {
      intent: "vote_poll",
      participantName: "Pat <Guest>",
      slot_pv_new_a: "YES",
      slot_pv_new_b: "MAYBE",
      "cf-turnstile-response": "solved",
    })) as { data: { success: boolean } };
    expect(res.data.success).toBe(true);
    const mails = toOrganizer();
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe('New vote: Pat <Guest> on "Team <Lunch>"');
    expect(mails[0].html).toContain("<strong>Pat &lt;Guest&gt;</strong> voted on <strong>Team &lt;Lunch&gt;</strong>.");
    expect(mails[0].html).toContain("<strong>Yes:</strong><br>Monday, June 1st, 2099 · 10:00 AM");
    expect(mails[0].html).toContain("<strong>Maybe:</strong><br>Tuesday, June 2nd, 2099");
    expect(mails[0].html).toContain("<strong>Leading option so far:</strong> Monday, June 1st, 2099 · 10:00 AM (1 yes)");
    expect(mails[0].html).toContain(`${SITE_URL}/events/pv_new`);
    expect(
      db.sqlite.prepare("SELECT count FROM usage_counters WHERE key LIKE 'email:organizer-update:pv_new:%'").get()
    ).toMatchObject({ count: 1 });
  });

  it("sends the voter confirmation and the organizer update separately", async () => {
    await seedPoll("pv_both");
    await post("pv_both", {
      intent: "vote_poll",
      participantName: "Pat",
      participantEmail: "pat@kay.com",
      slot_pv_both_a: "YES",
      "cf-turnstile-response": "solved",
    });
    expect(sent.map((m) => m.to[0]).sort()).toEqual(["pat@kay.com", "sam@example.com"]);
    expect(toOrganizer()[0].html).toContain("<strong>Pat (pat@kay.com)</strong> voted on");
  });

  it("emails the organizer when a voter edits their own vote", async () => {
    await seedPoll("pv_edit");
    await addVote("v1", "pv_edit", "Fay", "own-token");
    await post("pv_edit", {
      intent: "vote_poll",
      participantName: "Fay",
      clientVoteId: "v1",
      clientVoteToken: "own-token",
      slot_pv_edit_b: "YES",
      "cf-turnstile-response": "solved",
    });
    const mails = toOrganizer();
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toContain("Vote updated: Fay");
    expect(mails[0].html).toContain("<strong>Yes:</strong><br>Tuesday, June 2nd, 2099");
  });

  it("emails the organizer when a voter proposes a new time", async () => {
    await seedPoll("pv_prop");
    await post("pv_prop", {
      intent: "propose_slot",
      participantName: "Hal",
      slotDate: "2099-07-01",
      slot_pv_prop_a: "MAYBE",
      "cf-turnstile-response": "solved",
    });
    const mails = toOrganizer();
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toContain("New vote: Hal");
    expect(mails[0].html).toContain("<strong>Yes:</strong><br>Wednesday, July 1st, 2099");
    expect(mails[0].html).toContain("<strong>Maybe:</strong><br>Monday, June 1st, 2099 · 10:00 AM");
  });

  it("emails the organizer when a voter removes their vote through the cancel link", async () => {
    await seedPoll("pv_cancel");
    await addVote("v2", "pv_cancel", "Lee", "cancel-token", "lee@example.com");
    const res = await post("pv_cancel", { intent: "cancel_by_token", cancel_token: "cancel-token" });
    expect((res as Response).headers.get("Location")).toContain("cancelled=1");
    const mails = toOrganizer();
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toContain("Vote removed: Lee");
    expect(mails[0].html).toContain("<strong>Lee (lee@example.com)</strong> removed their vote from");
    expect(mails[0].html).not.toContain("Leading option so far");
  });

  it("emails the organizer when a voter deletes their vote with the edit token", async () => {
    await seedPoll("pv_del");
    await addVote("v3", "pv_del", "Kim", "edit-token");
    await post("pv_del", { intent: "delete_poll_vote", voteId: "v3", editToken: "edit-token" });
    expect(toOrganizer()).toHaveLength(1);
    expect(toOrganizer()[0].subject).toContain("Vote removed: Kim");
  });

  it("does not email the organizer about their own admin actions", async () => {
    await seedPoll("pv_admin");
    await addVote("v4", "pv_admin", "Ann", "t");
    await post("pv_admin", { intent: "delete_poll_vote", voteId: "v4", adminToken: ADMIN });
    await post("pv_admin", {
      intent: "vote_poll",
      participantName: "Sam",
      adminToken: ADMIN,
      slot_pv_admin_a: "YES",
      "cf-turnstile-response": "solved",
    });
    expect(toOrganizer()).toHaveLength(0);
  });

  it("sends nothing when the poll has no organizer email", async () => {
    await seedPoll("pv_none", "");
    const res = (await post("pv_none", {
      intent: "vote_poll",
      participantName: "Pat",
      slot_pv_none_a: "YES",
      "cf-turnstile-response": "solved",
    })) as { data: { success: boolean } };
    expect(res.data.success).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("keeps the vote when the organizer update cap is reached", async () => {
    await seedPoll("pv_cap");
    const day = new Date().toISOString().slice(0, 10);
    db.sqlite
      .prepare("INSERT INTO usage_counters (key, count, updated_at) VALUES (?, 50, ?)")
      .run(`email:organizer-update:pv_cap:${day}`, new Date().toISOString());
    const res = (await post("pv_cap", {
      intent: "vote_poll",
      participantName: "Pat",
      slot_pv_cap_a: "YES",
      "cf-turnstile-response": "solved",
    })) as { data: { success: boolean } };
    expect(res.data.success).toBe(true);
    expect(toOrganizer()).toHaveLength(0);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM poll_votes").get()).toMatchObject({ n: 1 });
  });
});

describe("buildPollVoteUpdateEmail", () => {
  const site = getSiteConfig(testEnv(db ?? createSqliteD1()));

  it("says when the voter picked none of the options", () => {
    const { html } = buildPollVoteUpdateEmail({
      kind: "vote",
      eventTitle: "Lunch",
      participantName: "Pat",
      yes: [],
      maybe: [],
      leadingLine: "",
      eventUrl: `${SITE_URL}/events/x`,
      site,
    });
    expect(html).toContain("none of the options");
    expect(html).not.toContain("Leading option so far");
  });
});
