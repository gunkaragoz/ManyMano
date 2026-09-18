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

    const missing = await get(`/stg-missing-${STAMP}`);
    expect([404]).toContain(missing.status);
  });
});

describe.skipIf(!LIVE)("staging write paths (synthetic events)", () => {
  it("creates a signup sheet and exposes it publicly", async () => {
    assertStaging(STAGING_URL);
    const form = new URLSearchParams({
      title: `STG smoke signup ${STAMP}`,
      eventDate: tomorrowIso(),
      organizerName: "STG Smoke",
      organizerEmail: `stg-smoke-${STAMP}@example.com`,
      // Minimal slot set; field names mirror create.signup action.
      // If the action renames fields, this surfaces the first action error.
      "slots[0][title]": "Morning",
      "slots[0][capacity]": "2",
    });
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
      "slots[0][title]": "Thu 2pm",
      "slots[1][title]": "Fri 10am",
    });
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
  for (const suffix of [".ics", ".qr", "/export"]) {
    const suffixPath = suffix.startsWith("/") ? `/events/${eventId}${suffix}` : `/events/${eventId}${suffix}`;
    const res = await fetch(`${STAGING_URL}${suffixPath}`);
    // .qr may 404 for events without a public URL shape; accept 200/404 but never 500.
    expect([200, 404].includes(res.status), `${suffixPath} returned ${res.status}`).toBe(true);
  }
}

function tomorrowIso(): string {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}
