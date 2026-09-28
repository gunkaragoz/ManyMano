// Route-level checks for organizer email: the real events.$id action/loader
// against an in-memory SQLite D1, with fetch stubbed so nothing leaves the
// process. Also regression coverage for events that have no organizer email
// (created over MCP): public pages, recovery, reminders and calendars.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { action, loader } from "~/routes/events.$id";
import { sha256Hex } from "~/utils/auth";
import { generateICS } from "~/utils/calendar";
import { getDb } from "~/db";
import { runReminderFanout } from "~/utils/reminders-run";
import { getSiteConfig } from "~/utils/site";
import { EMAIL_SAVED_AND_SENT, EMAIL_SAVED_NOT_SENT } from "~/utils/organizer-email";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { SITE_URL, eventRow, postForm, routeContext, seedEvent, testEnv } from "./helpers/route-harness";
import type { CloudflareEnv } from "~/utils/cloudflare-context";

type Result = { status: number; body: Record<string, unknown> };

function unwrap(res: unknown): Result {
  if (res instanceof Response) return { status: res.status, body: {} };
  const r = res as { data: Record<string, unknown>; init?: { status?: number } | null };
  return { status: r.init?.status ?? 200, body: r.data };
}

async function runAction(env: CloudflareEnv, id: string, fields: Record<string, string>, headers: Record<string, string>) {
  const request = postForm(`/events/${id}`, fields, headers);
  return unwrap(
    await action({ request, params: { id }, context: routeContext(env), url: new URL(request.url) } as never)
  );
}

async function runLoader(env: CloudflareEnv, path: string, id: string, reqHeaders: Record<string, string> = {}) {
  const request = new Request(`${SITE_URL}${path}`, { headers: reqHeaders });
  return unwrap(
    await loader({ request, params: { id }, context: routeContext(env), url: new URL(request.url) } as never)
  );
}

const TURNSTILE_HOST = "challenges.cloudflare.com";
const RESEND_HOST = "api.resend.com";
// Compare parsed hostnames, never substrings of the whole URL.
const hostOf = (input: unknown) => new URL(String(input instanceof Request ? input.url : input)).hostname;

const MAIL_ON = {
  RESEND_API_KEY: "re_test",
  TURNSTILE_SECRET_KEY: "ts_secret",
  TURNSTILE_HOSTNAMES: "example.com",
};

let db: SqliteD1;
let fetchMock: ReturnType<typeof vi.fn>;
let siteverifyOk = true;
let ipCounter = 0;
// A fresh client IP per test keeps the per-isolate limiters independent.
const headers = (extra: Record<string, string> = {}) => ({
  origin: SITE_URL,
  "cf-connecting-ip": `203.0.113.${++ipCounter}`,
  ...extra,
});

beforeEach(() => {
  db = createSqliteD1();
  siteverifyOk = true;
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const host = hostOf(input);
    if (host === TURNSTILE_HOST) {
      return Response.json(
        siteverifyOk
          ? { success: true, action: "set-organizer-email", hostname: "example.com" }
          : { success: false }
      );
    }
    if (host === RESEND_HOST) return Response.json({ id: "email_1" });
    throw new Error(`unexpected fetch to ${host}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const calledHosts = () => fetchMock.mock.calls.map((c) => hostOf(c[0]));

describe("set_organizer_email action", () => {
  it("saves the address without touching the admin token (mail off)", async () => {
    const { id, adminToken } = await seedEvent(db, { id: "e_save" });
    const before = eventRow(db, id).admin_token;
    const r = await runAction(
      testEnv(db),
      id,
      { intent: "set_organizer_email", adminToken, organizerEmail: " sam@example.com " },
      headers()
    );
    expect(r).toEqual({ status: 200, body: { success: true, message: EMAIL_SAVED_NOT_SENT } });
    expect(eventRow(db, id).organizer_email).toBe("sam@example.com");
    expect(eventRow(db, id).admin_token).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin post even with the right token", async () => {
    const { id, adminToken } = await seedEvent(db, { id: "e_xorigin" });
    const r = await runAction(
      testEnv(db),
      id,
      { intent: "set_organizer_email", adminToken, organizerEmail: "sam@example.com" },
      headers({ origin: "https://evil.test" })
    );
    expect(r.status).toBe(403);
    expect(eventRow(db, id).organizer_email).toBe("");
  });

  it("rejects a wrong admin token", async () => {
    const { id } = await seedEvent(db, { id: "e_badtoken" });
    const r = await runAction(
      testEnv(db),
      id,
      { intent: "set_organizer_email", adminToken: "nope", organizerEmail: "sam@example.com" },
      headers()
    );
    expect(r.status).toBe(403);
    expect(eventRow(db, id).organizer_email).toBe("");
  });

  it("with mail on, a failed Turnstile check saves and sends nothing", async () => {
    siteverifyOk = false;
    const { id, adminToken } = await seedEvent(db, { id: "e_ts_fail" });
    const r = await runAction(
      testEnv(db, MAIL_ON),
      id,
      { intent: "set_organizer_email", adminToken, organizerEmail: "sam@example.com", "cf-turnstile-response": "t" },
      headers()
    );
    expect(r.status).toBe(403);
    expect(eventRow(db, id).organizer_email).toBe("");
    expect(calledHosts()).not.toContain(RESEND_HOST);
  });

  it("with mail on and Turnstile passing, saves, sends the link once and counts it", async () => {
    const { id, adminToken } = await seedEvent(db, { id: "e_send" });
    const r = await runAction(
      testEnv(db, MAIL_ON),
      id,
      { intent: "set_organizer_email", adminToken, organizerEmail: "sam@example.com", "cf-turnstile-response": "t" },
      headers()
    );
    expect(r).toEqual({ status: 200, body: { success: true, message: EMAIL_SAVED_AND_SENT } });
    expect(eventRow(db, id).organizer_email).toBe("sam@example.com");
    const sends = fetchMock.mock.calls.filter((c) => hostOf(c[0]) === RESEND_HOST);
    expect(sends).toHaveLength(1);
    const payload = JSON.parse(String((sends[0][1] as RequestInit).body));
    expect(payload.to).toEqual(["sam@example.com"]);
    expect(payload.html).toContain(`${SITE_URL}/events/${id}?admin=${adminToken}`);
    expect(payload.html).toContain("Park &lt;Cleanup&gt;");
    const counted = db.sqlite.prepare("SELECT SUM(count) AS n FROM usage_counters WHERE key LIKE 'email:daily:%'").get() as {
      n: number;
    };
    expect(counted.n).toBe(1);
  });

  it("with mail on but Turnstile unconfigured, refuses before saving", async () => {
    const { id, adminToken } = await seedEvent(db, { id: "e_no_ts" });
    const r = await runAction(
      testEnv(db, { RESEND_API_KEY: "re_test" }),
      id,
      { intent: "set_organizer_email", adminToken, organizerEmail: "sam@example.com" },
      headers()
    );
    expect(r.status).toBe(503);
    expect(eventRow(db, id).organizer_email).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("events with no organizer email", () => {
  it("public loader never exposes the email field; admin sees it empty", async () => {
    const { id, adminToken } = await seedEvent(db, { id: "e_load", slot: { id: "s1" } });
    const pub = await runLoader(testEnv(db), `/events/${id}`, id);
    expect(pub.body.event).toBeDefined();
    expect(pub.body.event).not.toHaveProperty("organizerEmail");
    // Admins arrive with the cookie the ?admin= link sets.
    const admin = await runLoader(testEnv(db), `/events/${id}`, id, { cookie: `mm_admin_${id}=${adminToken}` });
    expect(admin.body.isAdmin).toBe(true);
    expect((admin.body.event as { organizerEmail: string }).organizerEmail).toBe("");
  });

  it("recovery never matches an empty address and leaves the token alone", async () => {
    const { id } = await seedEvent(db, { id: "e_recover_empty" });
    const before = eventRow(db, id).admin_token;
    const r = await runAction(
      testEnv(db, MAIL_ON),
      id,
      { intent: "resend_admin_link", organizerEmail: "someone@example.com" },
      headers()
    );
    expect(r.body.success).toBe(true);
    expect(eventRow(db, id).admin_token).toBe(before);
    expect(calledHosts()).not.toContain(RESEND_HOST);
  });

  it("once an email is saved, recovery rotates the token and mails the new link", async () => {
    const { id, adminToken } = await seedEvent(db, { id: "e_recover", organizerEmail: "sam@example.com" });
    const r = await runAction(
      testEnv(db, { RESEND_API_KEY: "re_test" }),
      id,
      { intent: "resend_admin_link", organizerEmail: "SAM@example.com" },
      headers()
    );
    expect(r.body.success).toBe(true);
    expect(eventRow(db, id).admin_token).not.toBe(await sha256Hex(adminToken));
    expect(calledHosts().filter((h) => h === RESEND_HOST)).toHaveLength(1);
  });

  it("reminders skip the organizer without trying to send", async () => {
    await seedEvent(db, { id: "e_remind", eventDate: "2030-01-15", slot: { id: "s1", startTime: "09:00" } });
    const env = testEnv(db, { RESEND_API_KEY: "re_test" });
    const result = await runReminderFanout(getDb(db.d1), db.d1, getSiteConfig(env), env, {
      date: "2030-01-15",
      dryRun: false,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].organizer).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calendar files leave out the ORGANIZER line", () => {
    const ics = generateICS({
      uid: "u1",
      title: "Park Cleanup",
      eventDate: "2030-01-15",
      organizerName: "Sam",
      organizerEmail: "",
      prodid: "PRODID:-//Test//EN",
      uidDomain: "example.com",
      fallbackTitle: "Event",
    });
    expect(ics).not.toContain("ORGANIZER");
  });
});
