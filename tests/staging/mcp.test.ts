// Staging MCP smoke: create → read over the live /mcp endpoint.
//
// Runs ONLY when STAGING_URL is set; refuses non-staging hosts. Staging has
// no mail credentials, and MCP creation never sends mail anyway — this also
// checks the email counters don't move.
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
  expect(ok, `REFUSING MCP smoke against non-staging host ${host}`).toBe(true);
}

let id = 0;
async function rpc(method: string, params?: unknown) {
  const res = await fetch(`${STAGING_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) }),
  });
  expect(res.status, `${method} → ${res.status}`).toBe(200);
  return (await res.json()) as { result: any; error?: unknown };
}

async function emailCounts() {
  const usage = (await (await fetch(`${STAGING_URL}/api/usage`)).json()) as { email: { daily: number; monthly: number } };
  return usage.email;
}

// Far enough ahead to never be "past", near enough to stay inside retention.
const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

describe.skipIf(!LIVE)("staging MCP", () => {
  it("lists the three tools", async () => {
    assertStaging(STAGING_URL);
    const list = await rpc("tools/list");
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "create_signup_sheet",
      "create_poll",
      "get_event",
    ]);
  });

  it("creates a sheet and a poll, reads them back, admin link works, no mail counted", async () => {
    assertStaging(STAGING_URL);
    const before = await emailCounts();

    const sheet = await rpc("tools/call", {
      name: "create_signup_sheet",
      arguments: {
        title: `stg-mcp-${STAMP}`,
        date: inDays(14),
        timezone: "UTC",
        organizerName: "Staging Smoke",
        tasks: [
          { title: "Drinks", capacity: 2 },
          { title: "Setup", capacity: 3, startTime: "17:00", endTime: "18:00" },
        ],
      },
    });
    const created = sheet.result.structuredContent;
    expect(created.adminUrl).toContain(`${STAGING_URL}/events/${created.eventId}?admin=`);

    const read = await rpc("tools/call", { name: "get_event", arguments: { eventId: created.eventId } });
    expect(read.result.structuredContent.slots.map((s: { title: string; capacity: number }) => [s.title, s.capacity])).toEqual([
      ["Drinks", 2],
      ["Setup", 3],
    ]);

    // The admin link upgrades to the cookie and redirects to the clean URL.
    const admin = await fetch(created.adminUrl, { redirect: "manual" });
    expect(admin.status).toBe(302);
    expect(admin.headers.get("set-cookie") ?? "").toContain(`mm_admin_${created.eventId}=`);

    const poll = await rpc("tools/call", {
      name: "create_poll",
      arguments: {
        title: `stg-mcp-poll-${STAMP}`,
        timezone: "UTC",
        organizerName: "Staging Smoke",
        allDay: true,
        options: [{ date: inDays(15) }, { date: inDays(16) }],
      },
    });
    const pollRead = await rpc("tools/call", {
      name: "get_event",
      arguments: { eventId: poll.result.structuredContent.eventId },
    });
    expect(pollRead.result.structuredContent.options).toHaveLength(2);

    expect(await emailCounts()).toEqual(before);
  });
});
