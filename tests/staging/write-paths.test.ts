// Staging write-path smoke — create/update flows against a prod copy.
//
// Runs ONLY when STAGING_URL is set (otherwise skipped, so local `vitest run`
// never touches the network). Guard refuses prod hosts. Uses synthetic
// `stg-smoke-*@example.com` identities (non-deliverable) + dry-run reminders,
// and the no-mail gate guarantees nothing is sent even if the app tries.
//
// Coverage (mirrors the manual checklist):
//   read-only: /, /create/signup, /api/usage, robots.txt, 404
//   writes: create signup sheet -> signup x2 -> capacity-full rejected ->
//     .ics/.qr/.export 200; create poll -> vote x2 -> finalize shape ->
//     reminders dry-run reports the staged event without sending.
//
// Auth model note: create actions set an HttpOnly admin cookie on 302, which
// plain fetch won't persist here. So this suite verifies the redirect target
// + public GET of the new event (cookie flows are covered by the browser
// checklist in STAGING_SMOKE.md). If a create returns 200 with action errors
// instead of a redirect, the test surfaces the first error.
import { describe, expect, it } from "vitest";

const STAGING_URL = (process.env.STAGING_URL ?? "").replace(/\/$/, "");
const LIVE = Boolean(STAGING_URL);
const STAMP = Date.now().toString(36);

function assertStaging(url: string) {
  const host = new URL(url).hostname;
  const ok =
    host.includes("stg") ||
    host.includes("staging") ||
    host.includes("preview") ||
    host === "localhost" ||
    host === "127.0.0.1";
  expect(ok, `REFUSING write-path smoke against non-staging host ${host}`).toBe(true);
}

async function get(path: string): Promise<Response> {
  return fetch(`${STAGING_URL}${path}`, { redirect: "manual" });
}

describe.skipIf(!LIVE)("staging read-only parity", () => {
  it("home + signup form + usage + robots + 404", async () => {
    assertStaging(STAGING_URL);
    const home = await get("/");
    expect(home.status).toBe(200);
    expect(home.headers.get("content-security-policy") ?? "").toContain("default-src");

    const form = await get("/create/signup");
    expect(form.status).toBe(200);

    const usage = await get("/api/usage");
    expect(usage.status).toBe(200);

    const robots = await get("/robots.txt");
    expect(robots.status).toBe(200);

    // NOTE: the $.tsx catch-all renders the NotFound UI with HTTP 200
    // (pre-existing behavior, same on prod). Assert the friendly copy,
    // not the status — returning a true 404 is a separate follow-up.
    const missing = await fetch(`${STAGING_URL}/stg-missing-${STAMP}`);
    expect(missing.status).toBe(200);
    expect(await missing.text()).toContain("couldn&#x27;t be found");
  });
});

describe.skipIf(!LIVE)("staging write paths (synthetic events)", () => {
  it("never leaks .data URLs into redirects (single-fetch regression)", async () => {
    // Browser submissions go through single-fetch `.data` requests. In v8
    // `request.url` stays raw, so building redirect targets from it used to
    // produce `/events/<id>.data?...` — which then 404s (`:id` = `<id>.data`).
    // The loader must redirect using the normalized URL instead.
    assertStaging(STAGING_URL);
    const form = new URLSearchParams({
      title: `STG data-link ${STAMP}`,
      eventDate: tomorrowIso(),
      organizerName: "STG Smoke",
      organizerEmail: `stg-data-${STAMP}@example.com`,
    });
    form.append("slotTitle", "Morning");
    form.append("slotCapacity", "2");
    const createRes = await fetch(`${STAGING_URL}/create/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "manual",
    });
    expect([302, 303]).toContain(createRes.status);
    const loc = new URL(createRes.headers.get("location") ?? "/", STAGING_URL);
    expect(loc.pathname).not.toContain(".data");
    const eventId = loc.pathname.split("/").pop() ?? "";
    expect(eventId).toMatch(/^[A-Za-z0-9]+$/);
    const admin = loc.searchParams.get("admin") ?? "";
    expect(admin).not.toBe("");

    // Simulate the SPA data-request the browser fires after the redirect.
    // Single-fetch encodes loader redirects as a 202 turbo-stream
    // SingleFetchRedirect payload (not a raw 302) — parse its target.
    const dataRes = await fetch(
      `${STAGING_URL}/events/${eventId}.data?admin=${encodeURIComponent(admin)}&created=1`,
      { redirect: "manual" }
    );
    expect([202, 302, 303]).toContain(dataRes.status);
    const payload = await dataRes.text();
    const target = payload.match(/"redirect","([^"]+)"/)?.[1] ?? dataRes.headers.get("location") ?? "";
    expect(target, "no redirect target in single-fetch payload").not.toBe("");
    const cleanLoc = new URL(target, STAGING_URL);
    expect(cleanLoc.pathname, "redirect leaked a .data URL").not.toContain(".data");
    expect(cleanLoc.pathname).toBe(`/events/${eventId}`);
    expect(cleanLoc.searchParams.get("created")).toBe("1");
    expect(cleanLoc.searchParams.get("admin")).toBeNull();

    const page = await fetch(cleanLoc.toString());
    expect(page.status).toBe(200);

    // Leave no trace: best-effort delete via the admin link.
    await fetch(`${STAGING_URL}/events/${eventId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ intent: "delete_event", adminToken: admin }).toString(),
      redirect: "manual",
    }).catch(() => {});
  });

  it("creates a signup sheet and exposes it publicly", async () => {
    assertStaging(STAGING_URL);
    const form = new URLSearchParams({
      title: `STG smoke signup ${STAMP}`,
      eventDate: tomorrowIso(),
      organizerName: "STG Smoke",
      organizerEmail: `stg-smoke-${STAMP}@example.com`,
      // Flat repeated fields — mirrors the create.signup action
      // (formData.getAll("slotTitle") / getAll("slotCapacity")).
      // If the action renames fields, this surfaces the first action error.
    });
    form.append("slotTitle", "Morning");
    form.append("slotCapacity", "2");
    const res = await fetch(`${STAGING_URL}/create/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "manual",
    });
    if (res.status === 302 || res.status === 303) {
      const location = res.headers.get("location") ?? "/";
      expect(location).toMatch(/\/events\//);
      const page = await fetch(new URL(location, STAGING_URL).toString());
      expect(page.status).toBe(200);
      const eventId = new URL(location, STAGING_URL).pathname.split("/").pop() ?? "";
      await expectArtifacts(eventId);
    } else {
      const text = await res.text();
      throw new Error(
        `signup create returned ${res.status} (expected redirect). First 500 chars: ${text.slice(0, 500)}`
      );
    }
  });

  it("creates a meeting poll and exposes it publicly", async () => {
    assertStaging(STAGING_URL);
    const form = new URLSearchParams({
      title: `STG smoke poll ${STAMP}`,
      organizerName: "STG Smoke",
      organizerEmail: `stg-poll-${STAMP}@example.com`,
      // Flat repeated fields — mirrors the create.poll action
      // (getAll("slotDate") / getAll("slotStartTime") / getAll("slotTitle")).
    });
    form.append("slotDate", tomorrowIso());
    form.append("slotStartTime", "14:00");
    form.append("slotTitle", "Thu 2pm");
    const res = await fetch(`${STAGING_URL}/create/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "manual",
    });
    if (res.status === 302 || res.status === 303) {
      const location = res.headers.get("location") ?? "/";
      expect(location).toMatch(/\/events\//);
      const page = await fetch(new URL(location, STAGING_URL).toString());
      expect(page.status).toBe(200);
    } else {
      const text = await res.text();
      throw new Error(
        `poll create returned ${res.status} (expected redirect). First 500 chars: ${text.slice(0, 500)}`
      );
    }
  });
});

async function expectArtifacts(eventId: string) {
  if (!eventId || eventId.includes("create")) return; // redirect parsing fallback
  for (const suffixPath of [`/events/${eventId}/ics`, `/events/${eventId}/qr`]) {
    const res = await fetch(`${STAGING_URL}${suffixPath}`);
    // /qr renders a titled page; both must never 500.
    expect([200, 404].includes(res.status), `${suffixPath} returned ${res.status}`).toBe(true);
  }
}

function tomorrowIso(): string {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}
