import { describe, expect, it } from "vitest";
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  absoluteUrl,
  breadcrumbJsonLd,
  getHomeFaq,
  getPageMeta,
  mergeParentMeta,
  organizationJsonLd,
  pageMetaOverrides,
  rootSiteFromMatches,
  softwareAppJsonLd,
  truncate,
  websiteJsonLd,
} from "~/utils/seo";

const SITE_URL = "https://stg.example.com";
const SITE_NAME = "ManyMano";

describe("seo helpers", () => {
  it("builds absolute URLs", () => {
    expect(absoluteUrl("/og-cover.png", SITE_URL)).toBe(`${SITE_URL}/og-cover.png`);
    expect(absoluteUrl("x", `${SITE_URL}/`)).toBe(`${SITE_URL}/x`);
    expect(() => absoluteUrl("/x", "")).toThrow();
  });

  it("builds JSON-LD without hardcoding brand", () => {
    const org = organizationJsonLd(SITE_URL, SITE_NAME, "https://github.com/e/m");
    expect(org.sameAs).toEqual(["https://github.com/e/m"]);
    expect(organizationJsonLd(SITE_URL, SITE_NAME).sameAs).toBeUndefined();
    expect(websiteJsonLd(SITE_URL, SITE_NAME, "tag").name).toBe(SITE_NAME);
    expect(softwareAppJsonLd(SITE_URL, SITE_NAME, "desc").isAccessibleForFree).toBe(true);
    expect(OG_IMAGE_WIDTH).toBe(1200);
    expect(OG_IMAGE_HEIGHT).toBe(630);
  });

  it("merges parent meta without losing OG image descriptors", () => {
    const parent = [{ property: "og:image", content: "x" }, { name: "description", content: "old" }];
    const merged = mergeParentMeta([{ meta: parent }], pageMetaOverrides({
      title: "T",
      description: "new",
      path: "/create/signup",
      siteUrl: SITE_URL,
    }));
    const byProp = (p: string) => merged.find((d) => d.property === p);
    expect(byProp("og:image")).toMatchObject({ content: "x" });
    expect(byProp("og:title")).toMatchObject({ content: "T" });
  });

  it("templates page meta on brand", () => {
    const pages = getPageMeta(SITE_NAME);
    expect(pages.createSignup.path).toBe("/create/signup");
    expect(pages.createPoll.title).toContain(SITE_NAME);
    expect(getHomeFaq(SITE_NAME).length).toBeGreaterThan(5);
  });

  it("resolves root site from matches or throws", () => {
    const site = rootSiteFromMatches([{ id: "root", loaderData: { site: { siteUrl: SITE_URL, siteName: SITE_NAME } } }]);
    expect(site.siteUrl).toBe(SITE_URL);
    expect(() => rootSiteFromMatches([{ id: "root", loaderData: {} }])).toThrow();
  });

  it("truncates titles on word boundaries", () => {
    expect(truncate("short", 70)).toBe("short");
    expect(truncate("a ".repeat(100), 70).length).toBeLessThanOrEqual(70);
  });

  it("builds breadcrumbs", () => {
    const b = breadcrumbJsonLd([{ name: "Home", path: "/" }], SITE_URL);
    expect(b.itemListElement[0].item).toBe(`${SITE_URL}/`);
  });
});
