import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MCP_DAILY_LIMIT_DEFAULT,
  MCP_WRITE_DAILY_LIMIT_DEFAULT,
  getMcpLimits,
  getMcpUsage,
  mcpCounterKey,
  reserveMcpUnit,
  resetMcpQuotaCache,
  secondsUntilUtcMidnight,
} from "~/utils/mcp-quota";
import { createSqliteD1 } from "./helpers/sqlite-d1";

const NOW = new Date("2026-09-27T23:59:00Z");
const LIMITS = { calls: 5, writes: 2 };

function count(db: ReturnType<typeof createSqliteD1>, key: string): number | undefined {
  return (db.sqlite.prepare("SELECT count FROM usage_counters WHERE key = ?").get(key) as { count: number } | undefined)
    ?.count;
}

beforeEach(() => resetMcpQuotaCache());
afterEach(() => vi.unstubAllGlobals());

describe("getMcpLimits", () => {
  it("uses defaults when unset and parses positive integers", () => {
    expect(getMcpLimits({})).toEqual({ calls: MCP_DAILY_LIMIT_DEFAULT, writes: MCP_WRITE_DAILY_LIMIT_DEFAULT });
    expect(getMcpLimits({ MCP_DAILY_LIMIT: " 50 ", MCP_WRITE_DAILY_LIMIT: "" })).toEqual({ calls: 50, writes: 200 });
  });

  it("fails closed on malformed values", () => {
    for (const bad of ["0", "-5", "1e3", "abc", "10.5"]) {
      expect(() => getMcpLimits({ MCP_DAILY_LIMIT: bad })).toThrow(/MCP_DAILY_LIMIT/);
    }
  });
});

describe("reserveMcpUnit", () => {
  it("admits up to the limit under concurrency and never overshoots", async () => {
    const db = createSqliteD1();
    const got = await Promise.all(Array.from({ length: 20 }, () => reserveMcpUnit(db.d1, "calls", LIMITS, NOW)));
    expect(got.filter(Boolean)).toHaveLength(5);
    expect(count(db, mcpCounterKey("calls", NOW))).toBe(5);
  });

  it("keeps calls and writes separate", async () => {
    const db = createSqliteD1();
    expect(await reserveMcpUnit(db.d1, "writes", LIMITS, NOW)).toBe(true);
    expect(await reserveMcpUnit(db.d1, "writes", LIMITS, NOW)).toBe(true);
    expect(await reserveMcpUnit(db.d1, "writes", LIMITS, NOW)).toBe(false);
    // Reads (calls) still have room after creates are spent.
    expect(await reserveMcpUnit(db.d1, "calls", LIMITS, NOW)).toBe(true);
  });

  it("starts fresh on the next UTC day", async () => {
    const db = createSqliteD1();
    for (let i = 0; i < 2; i++) await reserveMcpUnit(db.d1, "writes", LIMITS, NOW);
    expect(await reserveMcpUnit(db.d1, "writes", LIMITS, NOW)).toBe(false);
    const tomorrow = new Date("2026-09-28T00:00:01Z");
    expect(await reserveMcpUnit(db.d1, "writes", LIMITS, tomorrow)).toBe(true);
  });

  it("caches exhaustion so later calls skip D1", async () => {
    const db = createSqliteD1();
    for (let i = 0; i < 3; i++) await reserveMcpUnit(db.d1, "writes", LIMITS, NOW);
    db.failOn = /usage_counters/; // any D1 touch would now throw
    expect(await reserveMcpUnit(db.d1, "writes", LIMITS, NOW)).toBe(false);
  });

  it("throws when storage fails and counts nothing on rejection", async () => {
    const db = createSqliteD1();
    db.failOn = /usage_counters/;
    await expect(reserveMcpUnit(db.d1, "calls", LIMITS, NOW)).rejects.toThrow();
    db.failOn = null;
    for (let i = 0; i < 8; i++) await reserveMcpUnit(db.d1, "calls", LIMITS, NOW);
    expect(count(db, mcpCounterKey("calls", NOW))).toBe(5);
  });

  it("alerts once per threshold, on the admission that crosses it", async () => {
    const db = createSqliteD1();
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        posts.push(JSON.parse(String(init?.body)).text);
        return new Response("ok");
      })
    );
    const limits = { calls: 10, writes: 1 };
    const alerts = { webhookUrl: "https://hooks.example/x", appName: "ManyMano" };
    for (let i = 0; i < 15; i++) await reserveMcpUnit(db.d1, "calls", limits, NOW, alerts);
    expect(posts).toHaveLength(3);
    expect(posts[0]).toContain("8/10");
    expect(posts[1]).toContain("9/10");
    expect(posts[2]).toContain("10/10");
    expect(posts[2]).toContain("00:00 UTC");
  });

  it("defers alert delivery when asked", async () => {
    const db = createSqliteD1();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    const deferred: Promise<unknown>[] = [];
    await reserveMcpUnit(db.d1, "writes", { calls: 10, writes: 1 }, NOW, {
      webhookUrl: "https://hooks.example/x",
      defer: (p) => deferred.push(p),
    });
    expect(deferred.length).toBeGreaterThan(0);
    await Promise.all(deferred);
  });
});

describe("getMcpUsage", () => {
  it("reports counts and time to reset", async () => {
    const db = createSqliteD1();
    await reserveMcpUnit(db.d1, "calls", LIMITS, NOW);
    expect(await getMcpUsage(db.d1, NOW)).toEqual({ day: "2026-09-27", calls: 1, writes: 0, resetsInSeconds: 60 });
  });

  it("reports unreadable counters as null, not zero", async () => {
    const db = createSqliteD1();
    db.failOn = /usage_counters/;
    const usage = await getMcpUsage(db.d1, NOW);
    expect(usage.calls).toBeNull();
    expect(usage.writes).toBeNull();
  });

  it("secondsUntilUtcMidnight is at least 1", () => {
    expect(secondsUntilUtcMidnight(new Date("2026-09-27T23:59:59.900Z"))).toBe(1);
    expect(secondsUntilUtcMidnight(new Date("2026-09-27T00:00:00Z"))).toBe(86400);
  });
});
