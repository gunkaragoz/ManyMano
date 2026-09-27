// End-to-end through the real SDK transport: HTTP request in, JSON-RPC out,
// against the node:sqlite D1 stand-in. fetch is stubbed to fail loudly, so
// any outside call (mail, webhooks) would break a test.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcp, MAX_BODY_BYTES } from "~/mcp/handler";
import { createWindowLimiter } from "~/mcp/rate-limit";
import { resetMcpQuotaCache } from "~/utils/mcp-quota";
import type { CloudflareEnv } from "~/utils/cloudflare-context";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";
import { SITE_URL, testEnv } from "./helpers/route-harness";

const URL_MCP = `${SITE_URL}/mcp`;
const PROTOCOL = "2025-11-25";

let db: SqliteD1;
let env: CloudflareEnv;
let ipCounter = 0;
let ip = "";
const deferred: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void deferred.push(p) };

beforeEach(() => {
  db = createSqliteD1();
  env = testEnv(db, { MCP_ENABLED: "true" });
  ip = `198.51.100.${++ipCounter}`;
  resetMcpQuotaCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no outside calls expected");
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL,
      "cf-connecting-ip": ip,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let nextId = 1;
const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) });
const call = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });

async function send(body: unknown, headers?: Record<string, string>, e = env) {
  const res = await handleMcp(post(body, headers), e, ctx);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // plain-text responses
  }
  return { res, json, text };
}

const SHEET = {
  title: "Potluck",
  date: "2030-06-01",
  timezone: "UTC",
  organizerName: "Sam",
  tasks: [{ title: "Drinks", capacity: 2 }],
};

const counter = (key: string) =>
  (db.sqlite.prepare("SELECT count FROM usage_counters WHERE key LIKE ?").get(key) as { count: number } | undefined)?.count;

describe("gating", () => {
  it("is a plain 404 with no D1 work unless MCP_ENABLED is exactly 'true'", async () => {
    db.failOn = /./;
    for (const flag of [undefined, "false", "TRUE", "1"]) {
      const { res } = await send(rpc("tools/list"), {}, testEnv(db, { MCP_ENABLED: flag }));
      expect(res.status).toBe(404);
    }
  });

  it("the worker checks the flag before importing the MCP module", () => {
    const worker = readFileSync(resolve(process.cwd(), "workers/app.ts"), "utf8");
    const flag = worker.indexOf('env.MCP_ENABLED !== "true"');
    const imp = worker.indexOf('import("../app/mcp/handler")');
    expect(flag).toBeGreaterThan(-1);
    expect(imp).toBeGreaterThan(flag);
    expect(worker).toMatch(/Response\.redirect\(url\.toString\(\), 308\)/);
  });

  it("allows POST only", async () => {
    for (const method of ["GET", "DELETE", "PUT", "OPTIONS"]) {
      const res = await handleMcp(new Request(URL_MCP, { method }), env, ctx);
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    }
  });

  it("accepts no Origin (server clients) and the site's own origin (WebMCP), rejects others", async () => {
    expect((await send(rpc("tools/list"))).res.status).toBe(200);
    expect((await send(rpc("tools/list"), { Origin: SITE_URL })).res.status).toBe(200);
    expect((await send(rpc("tools/list"), { Origin: "https://evil.test" })).res.status).toBe(403);
    expect((await send(rpc("tools/list"), { Origin: "null" })).res.status).toBe(403);
  });

  it("marks every response no-store", async () => {
    for (const body of [rpc("tools/list"), "not json", call("get_event", { eventId: "nope" })]) {
      const { res } = await send(body);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

describe("body and message checks", () => {
  it("caps the body even when Content-Length is missing or lies", async () => {
    const big = JSON.stringify({ ...rpc("tools/list"), params: { pad: "a".repeat(MAX_BODY_BYTES) } });
    expect((await send(big)).res.status).toBe(413);
    expect((await send(big, { "Content-Length": "10" })).res.status).toBe(413);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const req = new Request(URL_MCP, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "cf-connecting-ip": ip },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await handleMcp(req, env, ctx)).status).toBe(413);
  });

  it("rejects compressed bodies, bad JSON, batches and non-JSON-RPC", async () => {
    expect((await send(rpc("tools/list"), { "Content-Encoding": "gzip" })).res.status).toBe(415);
    const bad = await send("{nope");
    expect(bad.res.status).toBe(400);
    expect(bad.json.error.code).toBe(-32700);
    const batch = await send([rpc("tools/list"), rpc("tools/list")]);
    expect(batch.res.status).toBe(400);
    expect(batch.json.error.message).toMatch(/Batch/);
    expect((await send({ hello: "world" })).res.status).toBe(400);
  });

  it("leaves Accept / Content-Type / version checks to the SDK", async () => {
    expect((await send(rpc("tools/list"), { Accept: "application/json" })).res.status).toBe(406);
    expect((await send(rpc("tools/list"), { "Content-Type": "text/plain" })).res.status).toBe(415);
    expect((await send(rpc("tools/list"), { "MCP-Protocol-Version": "1999-01-01" })).res.status).toBe(400);
  });
});

describe("lifecycle across separate stateless requests", () => {
  it("initialize → initialized → tools/list → tools/call, with no session id", async () => {
    const init = await send(
      rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "test", version: "1" } }),
      { "MCP-Protocol-Version": "" }
    );
    expect(init.res.status).toBe(200);
    expect(init.json.result.protocolVersion).toBe(PROTOCOL);
    expect(init.res.headers.get("mcp-session-id")).toBeNull();

    const note = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.res.status).toBe(202);

    const list = await send(rpc("tools/list"));
    const tools = list.json.result.tools as Array<{ name: string; annotations: Record<string, boolean> }>;
    expect(tools.map((t) => t.name)).toEqual(["create_signup_sheet", "create_poll", "get_event"]);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName.create_poll).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
    expect(byName.get_event).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });

    const created = await send(call("create_signup_sheet", SHEET));
    expect(created.json.result.isError).toBeUndefined();
    expect(created.json.result.structuredContent.eventId).toMatch(/^[A-Za-z0-9]{10}$/);
  });

  it("discovery never touches D1 (a WebMCP bridge can list tools on every page view)", async () => {
    db.failOn = /./;
    expect(
      (await send(rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "t", version: "1" } })))
        .res.status
    ).toBe(200);
    expect((await send({ jsonrpc: "2.0", method: "notifications/initialized" })).res.status).toBe(202);
    expect((await send(rpc("tools/list"))).res.status).toBe(200);
    expect((await send(rpc("ping"))).res.status).toBe(200);
  });
});

describe("tools", () => {
  it("create returns the links and note, and get_event reads it back", async () => {
    const { json } = await send(call("create_signup_sheet", SHEET));
    const out = json.result.structuredContent;
    expect(out.publicUrl).toBe(`${SITE_URL}/events/${out.eventId}`);
    expect(out.adminUrl).toMatch(new RegExp(`^${SITE_URL}/events/${out.eventId}\\?admin=[A-Za-z0-9]{32}$`));
    expect(out.qrUrl).toBe(`${out.publicUrl}/qr?format=png`);
    expect(out.note).toMatch(/No email was sent/);
    expect(JSON.parse(json.result.content[0].text)).toEqual(out);

    const read = await send(call("get_event", { eventId: out.eventId }));
    const summary = read.json.result.structuredContent;
    expect(summary).toMatchObject({ eventId: out.eventId, type: "signup_sheet", status: "open" });
    expect(JSON.stringify(summary)).not.toContain("admin");
  });

  it("creates polls", async () => {
    const { json } = await send(
      call("create_poll", {
        title: "Lunch",
        timezone: "UTC",
        organizerName: "Sam",
        allDay: true,
        options: [{ date: "2030-06-01" }, { date: "2030-06-02" }],
      })
    );
    const read = await send(call("get_event", { eventId: json.result.structuredContent.eventId }));
    expect(read.json.result.structuredContent.options).toHaveLength(2);
  });

  it("rejects unknown fields such as organizerEmail, and wrong types", async () => {
    const withEmail = await send(call("create_signup_sheet", { ...SHEET, organizerEmail: "a@b.co" }));
    expect(withEmail.json.result.isError).toBe(true);
    expect(withEmail.json.result.content[0].text).toMatch(/organizerEmail/);
    const stringCap = await send(call("create_signup_sheet", { ...SHEET, tasks: [{ title: "A", capacity: "2" }] }));
    expect(stringCap.json.result.isError).toBe(true);
    const n = db.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    expect(n.n).toBe(0);
  });

  it("returns domain errors as tool errors without writing", async () => {
    const past = await send(call("create_signup_sheet", { ...SHEET, date: "2020-01-01" }));
    expect(past.json.result).toMatchObject({ isError: true });
    expect(past.json.result.content[0].text).toMatch(/already passed/);
    expect(counter("mcp:writes:%")).toBeUndefined();
  });

  it("an admin cookie grants nothing extra", async () => {
    const { json } = await send(call("create_signup_sheet", SHEET));
    const { eventId, adminUrl } = json.result.structuredContent;
    const token = new URL(adminUrl).searchParams.get("admin");
    const plainRead = await send(call("get_event", { eventId }));
    const withCookie = await send(call("get_event", { eventId }), { Cookie: `mm_admin_${eventId}=${token}` });
    expect(withCookie.json.result).toEqual(plainRead.json.result);
  });

  it("hides internal errors behind a generic message", async () => {
    db.failOn = /from "?events"?/i;
    const r = await send(call("get_event", { eventId: "abc" }));
    expect(r.json.result.isError).toBe(true);
    expect(r.json.result.content[0].text).toBe("Can't read events right now. Try again later.");
  });
});

describe("quotas and limits", () => {
  it("counts only tools/call against the daily call budget", async () => {
    await send(rpc("tools/list"));
    await send(call("get_event", { eventId: "x" }));
    await send(call("get_event", { eventId: "y" }));
    expect(counter("mcp:calls:%")).toBe(2);
  });

  it("answers 429 with a Retry-After in seconds once the call budget is spent", async () => {
    const e = testEnv(db, { MCP_ENABLED: "true", MCP_DAILY_LIMIT: "2" });
    await send(call("get_event", { eventId: "x" }), {}, e);
    await send(call("get_event", { eventId: "x" }), {}, e);
    const over = await send(call("get_event", { eventId: "x" }), {}, e);
    expect(over.res.status).toBe(429);
    expect(over.res.headers.get("Retry-After")).toMatch(/^\d+$/);
    // Discovery still works.
    expect((await send(rpc("tools/list"), {}, e)).res.status).toBe(200);
  });

  it("refuses creates once the write budget is spent, while reads continue", async () => {
    const e = testEnv(db, { MCP_ENABLED: "true", MCP_WRITE_DAILY_LIMIT: "1" });
    const first = await send(call("create_signup_sheet", SHEET), {}, e);
    expect(first.json.result.isError).toBeUndefined();
    const second = await send(call("create_signup_sheet", SHEET), {}, e);
    expect(second.json.result.content[0].text).toMatch(/Daily create limit reached/);
    const read = await send(call("get_event", { eventId: first.json.result.structuredContent.eventId }), {}, e);
    expect(read.json.result.isError).toBeUndefined();
  });

  it("fails closed: 503 when the budget can't be read, or when a limit is misconfigured", async () => {
    db.failOn = /usage_counters/;
    const down = await send(call("get_event", { eventId: "x" }));
    expect(down.res.status).toBe(503);
    expect(down.res.headers.get("Retry-After")).toBe("60");
    db.failOn = null;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = await send(call("get_event", { eventId: "x" }), {}, testEnv(db, { MCP_ENABLED: "true", MCP_DAILY_LIMIT: "lots" }));
    expect(bad.res.status).toBe(503);
    errSpy.mockRestore();
  });

  it("limits creates per IP to 10 per window", async () => {
    const results = [];
    for (let i = 0; i < 11; i++) results.push((await send(call("create_signup_sheet", SHEET))).json.result);
    expect(results.slice(0, 10).every((r) => !r.isError)).toBe(true);
    expect(results[10].content[0].text).toMatch(/Too many events/);
  });

  it("limits requests per IP to 60 per window", async () => {
    for (let i = 0; i < 60; i++) expect((await send(rpc("tools/list"))).res.status).toBe(200);
    const over = await send(rpc("tools/list"));
    expect(over.res.status).toBe(429);
    expect(over.res.headers.get("Retry-After")).toBe("600");
  });
});

describe("createWindowLimiter", () => {
  it("stays bounded when every key is still live", () => {
    const l = createWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) l.hit(`k${i}`, 0);
    expect(l.size).toBeLessThanOrEqual(100);
  });

  it("resets a key after its window", () => {
    const l = createWindowLimiter({ limit: 1, windowMs: 1000, maxKeys: 10 });
    expect(l.hit("a", 0)).toBe(true);
    expect(l.hit("a", 500)).toBe(false);
    expect(l.hit("a", 1500)).toBe(true);
  });
});
