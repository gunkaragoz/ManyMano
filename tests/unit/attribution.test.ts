import { describe, expect, it } from "vitest";
import { classifyChannel, normalizeLandingPath } from "~/utils/attribution";
import {
  clampConversionDays,
  conversionKey,
  getConversions,
  parseConversionKey,
  recordConversion,
  resolveLanding,
} from "~/utils/conversions";
import { TEMPLATES, templatePath } from "~/utils/templates";

const SITE = "manymano.test";

describe("classifyChannel", () => {
  it.each([
    [null, "direct"],
    ["", "direct"],
    ["not a url", "direct"],
    [`https://${SITE}/templates`, "direct"],
    [`https://www.${SITE}/`, "direct"],
    ["https://www.google.com/", "search"],
    ["https://www.google.co.uk/", "search"],
    ["https://www.bing.com/search?q=x", "search"],
    ["https://duckduckgo.com/", "search"],
    ["https://chatgpt.com/", "ai"],
    ["https://gemini.google.com/app", "ai"],
    ["https://www.perplexity.ai/", "ai"],
    ["https://l.facebook.com/", "social"],
    ["https://t.co/abc", "social"],
    ["https://www.reddit.com/r/PTA", "social"],
    ["https://someschool.org/newsletter", "referral"],
    ["https://notgoogle.example.com/", "referral"],
  ])("%s → %s", (ref, expected) => {
    expect(classifyChannel(ref, SITE)).toBe(expected);
  });
});

describe("normalizeLandingPath", () => {
  it.each([
    ["/", "/"],
    ["/templates/", "/templates"],
    ["/create/signup?template=potluck", "/create/signup"],
    ["/signup-sheet/book-fair", "/signup-sheet/book-fair"],
    ["/meeting-poll/Team-Lunch", "/meeting-poll/team-lunch"],
    ["/events/abc123?admin=secret", "/events"],
    ["/wp-admin/../../etc", "other"],
    ["/signup-sheet/<script>", "other"],
    ["/signup-sheet/a/b", "other"],
    [null, "other"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeLandingPath(raw)).toBe(expected);
  });
});

describe("resolveLanding", () => {
  it("keeps real template pages and drops made-up ones", () => {
    const real = templatePath(TEMPLATES[0]);
    expect(resolveLanding(real)).toBe(real);
    expect(resolveLanding("/signup-sheet/does-not-exist")).toBe("other");
    // Right slug, wrong type prefix: not a page that exists.
    const wrongType = real.startsWith("/signup-sheet/")
      ? real.replace("/signup-sheet/", "/meeting-poll/")
      : real.replace("/meeting-poll/", "/signup-sheet/");
    expect(resolveLanding(wrongType)).toBe("other");
    expect(resolveLanding(42)).toBe("other");
  });
});

describe("conversion keys", () => {
  it("round-trips", () => {
    const key = conversionKey("2026-09-21", "TIME_POLL", "search", "/meeting-poll/x");
    expect(parseConversionKey(key)).toEqual({
      day: "2026-09-21",
      type: "TIME_POLL",
      channel: "search",
      landing: "/meeting-poll/x",
    });
    expect(parseConversionKey("email:daily:2026-09-21")).toBeNull();
  });

  it("clamps the days window", () => {
    expect(clampConversionDays(null)).toBe(28);
    expect(clampConversionDays("7")).toBe(7);
    expect(clampConversionDays("-3")).toBe(28);
    expect(clampConversionDays("999")).toBe(90);
  });
});

/** Minimal D1 stand-in over a Map — enough for the two statements used. */
function fakeD1() {
  const store = new Map<string, number>();
  const db = {
    store,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              const key = args[0] as string;
              store.set(key, (store.get(key) ?? 0) + 1);
              return {};
            },
            async all() {
              const [lo, hi] = args as [string, string];
              const results = [...store.entries()]
                .filter(([k]) => k >= lo && k < hi)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, count]) => ({ key, count }));
              void sql;
              return { results };
            },
          };
        },
      };
    },
  };
  return db;
}

describe("recordConversion / getConversions", () => {
  it("counts per day, type, channel and landing, and reads a window back", async () => {
    const d1 = fakeD1();
    const page = templatePath(TEMPLATES[0]);
    const form = new FormData();
    form.set("attrLanding", page);
    form.set("attrChannel", "search");
    const now = new Date("2026-09-21T10:00:00Z");
    await recordConversion(d1 as unknown as D1Database, "SIGNUP_SHEET", form, now);
    await recordConversion(d1 as unknown as D1Database, "SIGNUP_SHEET", form, now);
    // Missing fields → unattributed, not an error.
    await recordConversion(d1 as unknown as D1Database, "TIME_POLL", new FormData(), now);
    // Outside a 7-day window.
    await recordConversion(d1 as unknown as D1Database, "TIME_POLL", form, new Date("2026-09-01T10:00:00Z"));
    // Unrelated counters in the same table are ignored.
    d1.store.set("email:daily:2026-09-21", 5);

    const rows = await getConversions(d1 as unknown as D1Database, 7, now);
    expect(rows).toEqual([
      { day: "2026-09-21", type: "SIGNUP_SHEET", channel: "search", landing: page, count: 2 },
      { day: "2026-09-21", type: "TIME_POLL", channel: "direct", landing: "other", count: 1 },
    ]);
  });

  it("never throws when D1 fails", async () => {
    const broken = { prepare: () => { throw new Error("down"); } };
    await expect(recordConversion(broken as unknown as D1Database, "TIME_POLL", new FormData())).resolves.toBeUndefined();
  });
});
