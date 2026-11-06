import { describe, expect, it } from "vitest";
import { getPageMeta } from "~/utils/seo";
import {
  DOODLE_ALTERNATIVE_PATH,
  LAST_CHECKED,
  SOURCES,
  comparisonRows,
  doodleFaq,
  featuredTemplates,
} from "~/utils/doodle-comparison";

const BRAND = "TestBrand";

describe("doodle comparison page", () => {
  it("templates every brand mention on the configured site name", () => {
    const meta = getPageMeta(BRAND).doodleAlternative;
    expect(meta.path).toBe(DOODLE_ALTERNATIVE_PATH);
    expect(meta.title).toContain(BRAND);
    expect(meta.title.length).toBeLessThanOrEqual(65);
    expect(meta.description.length).toBeLessThanOrEqual(160);
    const text = JSON.stringify([meta, comparisonRows(), doodleFaq(BRAND)]);
    expect(text).not.toMatch(/manymano/i);
    expect(doodleFaq(BRAND).some((f) => f.question.includes(BRAND))).toBe(true);
  });

  it("links only to real meeting-poll templates", () => {
    const featured = featuredTemplates();
    expect(featured).toHaveLength(6);
    for (const t of featured) expect(t.path).toMatch(/^\/meeting-poll\/[a-z0-9-]+$/);
  });

  it("cites https Doodle sources and a check date", () => {
    expect(SOURCES.length).toBeGreaterThan(0);
    for (const s of SOURCES) expect(s.url).toMatch(/^https:\/\/(doodle|help\.doodle)\.com\//);
    expect(LAST_CHECKED).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });

  it("doesn't claim features the product lacks", () => {
    const ours = Object.fromEntries(comparisonRows().map((r) => [r.feature, r.ours]));
    expect(ours["Hiding participants"]).toMatch(/^No/);
    expect(ours["Booking pages and 1:1 scheduling"]).toMatch(/^Not available/);
    expect(ours["Video meeting links"]).toMatch(/^No integration/);
  });
});
