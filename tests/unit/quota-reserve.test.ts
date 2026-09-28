import { describe, expect, it } from "vitest";
import { emailBudgetAvailable, reserveCounterBelowLimit } from "~/utils/quota";
import { createSqliteD1 } from "./helpers/sqlite-d1";

const NOW = "2026-09-27T12:00:00.000Z";
const LIMITS = { dailyLimit: 100, monthlyLimit: 3000 };

function setCount(db: ReturnType<typeof createSqliteD1>, key: string, count: number) {
  db.sqlite
    .prepare("INSERT OR REPLACE INTO usage_counters (key, count, updated_at) VALUES (?, ?, ?)")
    .run(key, count, NOW);
}

describe("reserveCounterBelowLimit", () => {
  it("admits up to the limit, then refuses without counting further", async () => {
    const db = createSqliteD1();
    const got = [];
    for (let i = 0; i < 5; i++) got.push(await reserveCounterBelowLimit(db.d1, "k", 3, NOW));
    expect(got).toEqual([true, true, true, false, false]);
    const row = db.sqlite.prepare("SELECT count FROM usage_counters WHERE key = 'k'").get() as { count: number };
    expect(row.count).toBe(3);
  });

  it("never over-admits under concurrent callers", async () => {
    const db = createSqliteD1();
    const got = await Promise.all(Array.from({ length: 50 }, () => reserveCounterBelowLimit(db.d1, "k", 7, NOW)));
    expect(got.filter(Boolean)).toHaveLength(7);
  });

  it("keeps keys independent and refuses a zero limit", async () => {
    const db = createSqliteD1();
    expect(await reserveCounterBelowLimit(db.d1, "a", 1, NOW)).toBe(true);
    expect(await reserveCounterBelowLimit(db.d1, "b", 1, NOW)).toBe(true);
    expect(await reserveCounterBelowLimit(db.d1, "c", 0, NOW)).toBe(false);
  });

  it("throws when storage fails, so callers can fail closed", async () => {
    const db = createSqliteD1();
    db.failOn = /usage_counters/;
    await expect(reserveCounterBelowLimit(db.d1, "k", 3, NOW)).rejects.toThrow();
  });
});

describe("emailBudgetAvailable", () => {
  const now = new Date(NOW);

  it("is true with room left on both counters", async () => {
    const db = createSqliteD1();
    expect(await emailBudgetAvailable(db.d1, LIMITS, now)).toBe(true);
    setCount(db, "email:daily:2026-09-27", 99);
    expect(await emailBudgetAvailable(db.d1, LIMITS, now)).toBe(true);
  });

  it("is false when the daily or the monthly counter is spent", async () => {
    const daily = createSqliteD1();
    setCount(daily, "email:daily:2026-09-27", 100);
    expect(await emailBudgetAvailable(daily.d1, LIMITS, now)).toBe(false);

    const monthly = createSqliteD1();
    setCount(monthly, "email:monthly:2026-09", 3000);
    expect(await emailBudgetAvailable(monthly.d1, LIMITS, now)).toBe(false);
  });

  it("is false when usage can't be read", async () => {
    const db = createSqliteD1();
    db.failOn = /usage_counters/;
    expect(await emailBudgetAvailable(db.d1, LIMITS, now)).toBe(false);
  });
});
