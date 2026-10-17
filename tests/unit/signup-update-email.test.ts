import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "~/routes/events.$id";
import { sha256Hex } from "~/utils/auth";
import { buildSignupUpdateEmail, signupComment } from "~/utils/signup-update-email";
import { getSiteConfig } from "~/utils/site";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { SITE_URL, postForm, routeContext, seedEvent, testEnv } from "./helpers/route-harness";

let db: SqliteD1;
let sent: Array<{ to: string[]; subject: string; html: string }>;
let fetchMock: ReturnType<typeof vi.fn>;

async function post(id: string, fields: Record<string, string>, extraEnv = {}) {
  const request = postForm(`/events/${id}`, fields, { "cf-connecting-ip": "198.51.100.33" });
  return action({
    request,
    params: { id },
    context: routeContext(testEnv(db, { RESEND_API_KEY: "re_test", TURNSTILE_SECRET_KEY: "ts_secret", TURNSTILE_HOSTNAMES: "example.com", ...extraEnv })),
    url: new URL(request.url),
  } as never);
}

beforeEach(() => {
  db = createSqliteD1();
  sent = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const host = new URL(String(input instanceof Request ? input.url : input)).hostname;
    if (host === "challenges.cloudflare.com") {
      return Response.json({ success: true, action: "event-signup", hostname: "example.com" });
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

describe("organizer sign-up updates", () => {
  it("echoes the confirmation attempt through challenge and completion", async () => {
    const { id } = await seedEvent(db, { id: "attempt_round_trip", slot: { id: "slot_attempt" } });
    const fields = {
      intent: "signup", slotId: "slot_attempt", signupAttemptId: "7",
      participantName: "Pat", participantEmail: "pat@example.com",
    };
    const challenged = await post(id, fields) as unknown as { data: Record<string, unknown> };
    expect(challenged.data).toMatchObject({ needsVerification: true, signupAttemptId: "7" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM signups").get()).toMatchObject({ n: 0 });

    const completed = await post(id, { ...fields, "cf-turnstile-response": "solved" }) as unknown as {
      data: Record<string, unknown>;
    };
    expect(completed.data).toMatchObject({ success: true, signupAttemptId: "7" });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM signups").get()).toMatchObject({ n: 1 });
  });

  it("emails the organizer after a guest signs up without an email and tracks the send", async () => {
    const { id } = await seedEvent(db, {
      id: "notify_signup",
      organizerEmail: "sam@example.com",
      eventDate: "2099-05-10",
      slot: { id: "slot_1", title: "Tables", capacity: 2, startTime: "09:00" },
    });
    db.sqlite.prepare("UPDATE events SET location = ? WHERE id = ?").run("Community Hall", id);
    db.sqlite.prepare("UPDATE event_slots SET shift_name = ? WHERE id = ?").run("Morning", "slot_1");
    const result = await post(id, {
      intent: "signup", slotId: "slot_1", participantName: "Pat <Guest>",
      comment: "I can bring <supplies>.",
      "cf-turnstile-response": "solved",
    });
    expect((result as { data: { success: boolean } }).data.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["sam@example.com"]);
    expect(sent[0].subject).toContain("New sign-up: \"Morning – Tables\"");
    expect(sent[0].html).toContain("Pat &lt;Guest&gt;");
    expect(sent[0].html).toContain("<strong>Pat &lt;Guest&gt;</strong> signed up for");
    expect(sent[0].html).toContain("<strong>Task:</strong> Tables");
    expect(sent[0].html).toContain("<strong>Shift:</strong> Morning");
    expect(sent[0].html).toContain("<strong>Where:</strong> Community Hall");
    expect(sent[0].html).toContain("I can bring &lt;supplies&gt;.");
    expect(sent[0].html).toContain(`${SITE_URL}/events/${id}`);
    expect(sent[0].html).toContain(">Open event</a>");
    expect(sent[0].html).toContain("May 10th, 2099");
    expect(db.sqlite.prepare("SELECT count FROM usage_counters WHERE key LIKE 'email:daily:%'").get()).toMatchObject({ count: 1 });
  });

  it("shows the participant email beside the name when provided", async () => {
    const { id } = await seedEvent(db, { id: "notify_with_email", organizerEmail: "sam@example.com", slot: { id: "slot_email", title: "Tables" } });
    await post(id, {
      intent: "signup", slotId: "slot_email", participantName: "Pat Kay",
      participantEmail: "pat@kay.com", "cf-turnstile-response": "solved",
    });
    const organizerMail = sent.find((mail) => mail.to.includes("sam@example.com"));
    expect(organizerMail?.html).toContain("<strong>Pat Kay (pat@kay.com)</strong> signed up for <strong>Park &lt;Cleanup&gt;</strong>.");
  });

  it("emails the organizer for self-service cancellation and sends only once", async () => {
    const { id } = await seedEvent(db, { id: "notify_cancel", organizerEmail: "sam@example.com", slot: { id: "slot_2" } });
    const token = "a-secret-cancel-token";
    db.sqlite.prepare(
      `INSERT INTO signups (id, slot_id, event_id, participant_name, participant_email, edit_token, custom_fields, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)`
    ).run("signup_1", "slot_2", id, "Pat", "pat@kay.com", await sha256Hex(token), JSON.stringify({ comment: "Bring a ladder" }), new Date().toISOString());
    const first = await post(id, { intent: "cancel_by_token", cancel_token: token });
    expect(first).toBeInstanceOf(Response);
    expect((first as Response).headers.get("Location")).toContain("cancelled=1");
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("Sign-up cancelled");
    expect(sent[0].html).toContain("<strong>Pat (pat@kay.com)</strong> cancelled their sign-up for");
    expect(sent[0].html).toContain("Bring a ladder");
    await post(id, { intent: "cancel_by_token", cancel_token: token });
    expect(sent).toHaveLength(1);
  });

  it("emails the organizer when an admin removes a signup", async () => {
    const { id, adminToken } = await seedEvent(db, { id: "notify_admin", organizerEmail: "sam@example.com", slot: { id: "slot_3" } });
    db.sqlite.prepare(
      `INSERT INTO signups (id, slot_id, event_id, participant_name, participant_email, edit_token, custom_fields, status, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, '{}', 'CONFIRMED', ?)`
    ).run("signup_2", "slot_3", id, "Lee", await sha256Hex("secret"), new Date().toISOString());
    await post(id, { intent: "cancel_signup", signupId: "signup_2", adminToken });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("Sign-up cancelled");
  });

  it("omits updates when the organizer has no email", async () => {
    const { id } = await seedEvent(db, { id: "no_address", slot: { id: "slot_4" } });
    await post(id, { intent: "signup", slotId: "slot_4", participantName: "Pat" });
    expect(sent).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the signup when the organizer update cap is reached", async () => {
    const { id } = await seedEvent(db, { id: "capped_updates", organizerEmail: "sam@example.com", slot: { id: "slot_5" } });
    const day = new Date().toISOString().slice(0, 10);
    db.sqlite.prepare("INSERT INTO usage_counters (key, count, updated_at) VALUES (?, 50, ?)")
      .run(`email:organizer-update:${id}:${day}`, new Date().toISOString());
    const result = await post(id, {
      intent: "signup", slotId: "slot_5", participantName: "Pat", "cf-turnstile-response": "solved",
    });
    expect((result as { data: { success: boolean } }).data.success).toBe(true);
    expect(sent).toHaveLength(0);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM signups").get()).toMatchObject({ n: 1 });
  });

  it("escapes event, task, and participant content", () => {
    const message = buildSignupUpdateEmail({
      kind: "signup", eventTitle: "<event>", participantName: "<person>", participantEmail: "person+<test>@example.com",
      taskLabel: "<task>", taskTitle: "<task>", shiftName: "<shift>", whenLine: "<date>",
      location: "<place>", comment: "<note>\nmore", eventUrl: `${SITE_URL}/events/test`,
      site: getSiteConfig(testEnv(db)),
    });
    expect(message.html).toContain("&lt;event&gt;");
    expect(message.html).toContain("&lt;person&gt;");
    expect(message.html).toContain("&lt;person&gt; (person+&lt;test&gt;@example.com)");
    expect(message.html).toContain("&lt;task&gt;");
    expect(message.html).toContain("&lt;date&gt;");
    expect(message.html).toContain("&lt;shift&gt;");
    expect(message.html).toContain("&lt;place&gt;");
    expect(message.html).toContain("&lt;note&gt;<br>more");
    expect(message.html).not.toContain("<person>");
  });

  it("ignores malformed or non-text stored notes", () => {
    expect(signupComment("bad json")).toBe("");
    expect(signupComment('{"comment":42}')).toBe("");
  });
});
