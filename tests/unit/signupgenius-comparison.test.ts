import { describe, expect, it } from "vitest";
import { getPageMeta } from "~/utils/seo";
import {
  LAST_CHECKED,
  SIGNUPGENIUS_ALTERNATIVE_PATH,
  SOURCES,
  comparisonRows,
  featuredTemplates,
  signupGeniusFaq,
} from "~/utils/signupgenius-comparison";

const BRAND = "TestBrand";

describe("signupgenius comparison page", () => {
  it("templates every brand mention on the configured site name", () => {
    const meta = getPageMeta(BRAND).signupgeniusAlternative;
    expect(meta.path).toBe(SIGNUPGENIUS_ALTERNATIVE_PATH);
    expect(meta.title).toContain(BRAND);
    expect(meta.title.length).toBeLessThanOrEqual(65);
    expect(meta.description.length).toBeLessThanOrEqual(160);
    const text = JSON.stringify([meta, comparisonRows(), signupGeniusFaq(BRAND)]);
    expect(text).not.toMatch(/manymano/i);
    expect(signupGeniusFaq(BRAND).some((f) => f.question.includes(BRAND))).toBe(true);
  });

  it("links only to real templates", () => {
    const featured = featuredTemplates();
    expect(featured).toHaveLength(6);
    for (const t of featured) expect(t.path).toMatch(/^\/signup-sheet\/[a-z0-9-]+$/);
  });

  it("cites https sources and a check date", () => {
    expect(SOURCES.length).toBeGreaterThan(0);
    for (const s of SOURCES) expect(s.url).toMatch(/^https:\/\/(www|support)\.signupgenius\.com\//);
    expect(LAST_CHECKED).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });

  it("doesn't claim features the product lacks", () => {
    const ours = Object.fromEntries(comparisonRows().map((r) => [r.feature, r.ours]));
    expect(ours["Waitlists"]).toMatch(/^No/);
    expect(ours["Collecting payments"]).toMatch(/^No/);
  });
});
