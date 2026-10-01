// Unique view counting for event pages: one count per browser, refresh-safe.
import { beforeEach, describe, expect, it } from "vitest";
import { loader, signupCountLabel } from "~/routes/events.$id";
import { trackEventView } from "~/utils/event-views";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { SITE_URL, routeContext, seedEvent, testEnv } from "./helpers/route-harness";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function req(path: string, headers: Record<string, string> = {}) {
  return new Request(`${SITE_URL}${path}`, { headers: { "user-agent": UA, ...headers } });
}

function viewerCookieFromSetCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const m = setCookie.match(/mm_viewer=([^;]+)/);
  return m ? `mm_viewer=${m[1]}` : null;
}

let db: SqliteD1;
beforeEach(() => {
  db = createSqliteD1();
});

describe("trackEventView", () => {
  it("counts the first view and issues a viewer cookie", async () => {
    await seedEvent(db, { id: "ev1" });
    const r = await trackEventView(db.d1, "ev1", req("/events/ev1"), { isAdmin: false, isPoll: false });
    expect(r.viewCount).toBe(1);
    expect(r.setViewerCookie).toMatch(/mm_viewer=/);
  });

  it("does not count refreshes from the same browser", async () => {
    await seedEvent(db, { id: "ev2" });
    const first = await trackEventView(db.d1, "ev2", req("/events/ev2"), { isAdmin: false, isPoll: false });
    const cookie = viewerCookieFromSetCookie(first.setViewerCookie);
    expect(cookie).toBeTruthy();
    const second = await trackEventView(db.d1, "ev2", req("/events/ev2", { cookie: cookie! }), {
      isAdmin: false,
      isPoll: false,
    });
    expect(second.viewCount).toBe(1);
    expect(second.setViewerCookie).toBeNull();
  });

  it("counts a second browser separately", async () => {
    await seedEvent(db, { id: "ev3" });
    await trackEventView(db.d1, "ev3", req("/events/ev3", { "cf-connecting-ip": "10.0.0.1" }), {
      isAdmin: false,
      isPoll: false,
    });
    const other = await trackEventView(
      db.d1,
      "ev3",
      req("/events/ev3", {
        cookie: "mm_viewer=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "cf-connecting-ip": "10.0.0.2",
      }),
      { isAdmin: false, isPoll: false }
    );
    expect(other.viewCount).toBe(2);
  });

  it("ignores admin views, live-sync polls and bots", async () => {
    await seedEvent(db, { id: "ev4" });
    const base = { isAdmin: false, isPoll: false } as const;
    const one = await trackEventView(db.d1, "ev4", req("/events/ev4"), base);
    expect(one.viewCount).toBe(1);
    const admin = await trackEventView(db.d1, "ev4", req("/events/ev4"), { isAdmin: true, isPoll: false });
    expect(admin.viewCount).toBe(1);
    const poll = await trackEventView(db.d1, "ev4", req("/events/ev4?poll=1"), { isAdmin: false, isPoll: true });
    expect(poll.viewCount).toBe(1);
    const bot = await trackEventView(
      db.d1,
      "ev4",
      req("/events/ev4", { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }),
      base
    );
    expect(bot.viewCount).toBe(1);
  });

  it("dedupes cookie-less refreshes from the same IP", async () => {
    await seedEvent(db, { id: "ev5" });
    const ipHeaders = { "cf-connecting-ip": "198.51.100.7" };
    const first = await trackEventView(db.d1, "ev5", req("/events/ev5", ipHeaders), {
      isAdmin: false,
      isPoll: false,
    });
    expect(first.viewCount).toBe(1);
    // Client ignored the cookie: same IP+UA still counts once.
    const second = await trackEventView(db.d1, "ev5", req("/events/ev5", ipHeaders), {
      isAdmin: false,
      isPoll: false,
    });
    expect(second.viewCount).toBe(1);
  });

  it("heals a lost adoption-delete instead of double counting forever", async () => {
    // Partial failure state: personal row inserted, but the fallback IP
    // slot deletion was lost — both rows present for one browser.
    await seedEvent(db, { id: "ev6" });
    const now = new Date().toISOString();
    const { sha256Hex } = await import("~/utils/auth");
    const personal = await sha256Hex("event-view:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    db.sqlite
      .prepare(
        `INSERT INTO event_views (event_id, viewer_key, first_seen, last_seen) VALUES (?, ?, ?, ?)`
      )
      .run("ev6", personal, now, now);
    // Orphaned IP slot for the same browser (same test IP+UA as req()).
    const orphan = await trackEventView(
      db.d1,
      "ev6",
      req("/events/ev6", { "cf-connecting-ip": "198.51.100.9" }),
      { isAdmin: false, isPoll: false }
    );
    expect(orphan.viewCount).toBe(2);
    // Next load presents the cookie: adoption is retried, count heals to 1.
    const healed = await trackEventView(
      db.d1,
      "ev6",
      req("/events/ev6", {
        cookie: "mm_viewer=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        "cf-connecting-ip": "198.51.100.9",
      }),
      { isAdmin: false, isPoll: false }
    );
    expect(healed.viewCount).toBe(1);
    const again = await trackEventView(
      db.d1,
      "ev6",
      req("/events/ev6", {
        cookie: "mm_viewer=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        "cf-connecting-ip": "198.51.100.9",
      }),
      { isAdmin: false, isPoll: false }
    );
    expect(again.viewCount).toBe(1);
  });
});

describe("signupCountLabel", () => {
  it("shows a fraction for fully capped sheets", () => {
    expect(signupCountLabel(3, 10, false)).toBe("3/10 signups");
    expect(signupCountLabel(0, 5, false)).toBe("0/5 signups");
  });

  it("falls back to a headcount when any slot is unlimited", () => {
    expect(signupCountLabel(7, 2, true)).toBe("7 signups");
    expect(signupCountLabel(1, 0, true)).toBe("1 signup");
    expect(signupCountLabel(0, 0, false)).toBe("0 signups");
  });
});

describe("event page loader viewCount", () => {
  async function runLoader(id: string, headers: Record<string, string> = {}) {
    const request = req(`/events/${id}`, headers);
    const res = (await loader({
      request,
      params: { id },
      context: routeContext(testEnv(db)),
      url: new URL(request.url),
    } as never)) as unknown as { data: Record<string, unknown>; init?: { headers?: Headers } };
    const setCookie = res.init?.headers instanceof Headers ? res.init.headers.get("set-cookie") : null;
    return { body: res.data, setCookie };
  }

  it("returns viewCount 1 on first load, stable on refresh", async () => {
    await seedEvent(db, { id: "evp", slot: { id: "s1" } });
    const first = await runLoader("evp");
    expect(first.body.viewCount).toBe(1);
    const cookie = viewerCookieFromSetCookie(first.setCookie);
    expect(cookie).toBeTruthy();
    const second = await runLoader("evp", { cookie: cookie! });
    expect(second.body.viewCount).toBe(1);
  });

  it("does not increment for organizer views", async () => {
    const { id, adminToken } = await seedEvent(db, { id: "eva", slot: { id: "s1" } });
    const guest = await runLoader(id);
    expect(guest.body.viewCount).toBe(1);
    const admin = await runLoader(id, { cookie: `mm_admin_${id}=${adminToken}` });
    expect(admin.body.isAdmin).toBe(true);
    expect(admin.body.viewCount).toBe(1);
  });
});
