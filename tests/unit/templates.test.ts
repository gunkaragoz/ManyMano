import { describe, expect, it } from "vitest";
import {
  HEADER_MENU_SLUGS,
  POPULAR_TEMPLATE_LINKS,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  getTemplate,
  pollPrefillFromTemplate,
  relatedTemplates,
  signupPrefillFromTemplate,
  templateCreatePath,
  templatePath,
} from "~/utils/templates";
import { isUnsupported, resolvePollPrefill, resolveSignupPrefill, simulateSignupSubmission } from "~/utils/prefill";
import {
  DESCRIPTION_MAX,
  LOCATION_MAX,
  MAX_SLOTS_PER_EVENT,
  SHIFT_NAME_MAX,
  SLOT_TITLE_MAX,
  TITLE_MAX,
  isValidTime,
  timeToMinutes,
} from "~/utils/validation";
import { expandDates } from "~/utils/recurrence";
import { selectionToSpec } from "~/utils/formDates";
import { loadTemplatePage } from "~/components/TemplatePage";
import { loader as libraryLoader } from "~/routes/templates._index";
import { loader as sitemapLoader } from "~/routes/sitemap[.]xml";
import { loader as llmsLoader } from "~/routes/llms[.]txt";
import { createSqliteD1 } from "./helpers/sqlite-d1";
import { SITE_URL, routeContext, testEnv } from "./helpers/route-harness";

// Several "todays": month/year ends, a leap day, and every weekday.
const TODAYS = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-12-31", "2028-02-28", "2028-02-29", "2027-06-30", "2026-10-01", "2026-10-05"];

describe("template catalog", () => {
  it("has unique slugs and known categories", () => {
    const slugs = TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const cats = new Set(TEMPLATE_CATEGORIES.map((c) => c.key));
    for (const t of TEMPLATES) expect(cats.has(t.category), t.slug).toBe(true);
  });

  it("covers both flows at the planned size", () => {
    expect(TEMPLATES.filter((t) => t.type === "SIGNUP_SHEET").length).toBeGreaterThanOrEqual(10);
    expect(TEMPLATES.filter((t) => t.type === "TIME_POLL").length).toBeGreaterThanOrEqual(5);
  });

  it("has distinct page content for every template", () => {
    const titles = new Set<string>();
    const intros = new Set<string>();
    for (const t of TEMPLATES) {
      expect(t.seo.title.length, t.slug).toBeLessThanOrEqual(60);
      expect(t.seo.description.length, t.slug).toBeLessThanOrEqual(160);
      expect(t.seo.intro.length, t.slug).toBeGreaterThanOrEqual(2);
      expect(t.seo.tips.length, t.slug).toBeGreaterThanOrEqual(3);
      expect(t.seo.faqs.length, t.slug).toBeGreaterThanOrEqual(2);
      titles.add(t.seo.title);
      intros.add(t.seo.intro[0]);
    }
    expect(titles.size).toBe(TEMPLATES.length);
    expect(intros.size).toBe(TEMPLATES.length);
  });

  it("keeps every field within the create form's limits", () => {
    for (const t of TEMPLATES) {
      if (t.type === "SIGNUP_SHEET") {
        const d = t.prefill.details;
        expect(d.title.length).toBeLessThanOrEqual(TITLE_MAX);
        expect(d.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(d.location.length).toBeLessThanOrEqual(LOCATION_MAX);
        for (const s of t.prefill.shifts) {
          expect(s.name.length).toBeLessThanOrEqual(SHIFT_NAME_MAX);
          if (s.startTime || s.endTime) {
            expect(isValidTime(s.startTime) && isValidTime(s.endTime), `${t.slug} ${s.name}`).toBe(true);
            expect(timeToMinutes(s.endTime)).toBeGreaterThan(timeToMinutes(s.startTime));
          }
          for (const task of s.tasks) {
            expect(task.title.length).toBeGreaterThan(0);
            expect(task.title.length).toBeLessThanOrEqual(SLOT_TITLE_MAX);
            expect(Number.isInteger(task.capacity) && task.capacity >= 1 && task.capacity <= 999).toBe(true);
          }
        }
      } else {
        expect(t.poll.title.length).toBeLessThanOrEqual(TITLE_MAX);
        expect(t.poll.durationMinutes).toBeGreaterThanOrEqual(5);
        expect(t.poll.durationMinutes).toBeLessThanOrEqual(1440);
        for (const s of t.poll.startTimes) expect(isValidTime(s)).toBe(true);
        expect(t.poll.dayOffsets.length * t.poll.startTimes.length).toBeLessThanOrEqual(MAX_SLOTS_PER_EVENT);
      }
    }
  });

  it("every template resolves for any today, within every limit, without truncation", () => {
    for (const today of TODAYS) {
      for (const t of TEMPLATES) {
        if (t.type === "SIGNUP_SHEET") {
          const p = signupPrefillFromTemplate(t);
          const r = resolveSignupPrefill(p, { today, timezone: "America/Chicago" });
          if (isUnsupported(r)) throw new Error(`${t.slug} @ ${today}: ${r.reason}`);
          expect(r.details.eventDate > today, `${t.slug} starts after today`).toBe(true);
          const sim = simulateSignupSubmission(r, today);
          if ("error" in sim) throw new Error(`${t.slug}: ${sim.error}`);
          const taskCount = t.prefill.shifts.reduce((n, s) => n + s.tasks.length, 0);
          expect(r.shifts.reduce((n, s) => n + s.tasks.length, 0)).toBe(taskCount);
        } else {
          const r = resolvePollPrefill(pollPrefillFromTemplate(t), { today, timezone: "America/Chicago" });
          if (isUnsupported(r)) throw new Error(`${t.slug} @ ${today}: ${r.reason}`);
          expect(r.days).toHaveLength(t.poll.dayOffsets.length * t.poll.startTimes.length);
          for (const d of r.days) expect(d.date > today).toBe(true);
        }
      }
    }
  });

  it("Staff week is Monday to Friday starting next Monday, one theme per day", () => {
    const t = getTemplate("staff-appreciation-week");
    if (!t || t.type !== "SIGNUP_SHEET") throw new Error("missing");
    const r = resolveSignupPrefill(signupPrefillFromTemplate(t), { today: "2026-09-28", timezone: "UTC" }); // a Monday
    if (isUnsupported(r)) throw new Error(r.reason);
    expect(r.details.eventDate).toBe("2026-10-05"); // strictly after today
    const dates = expandDates(selectionToSpec(r.dateSel, r.details.eventDate), r.details.eventDate);
    expect(dates).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(r.shifts.map((s) => s.days)).toEqual(dates.map((d) => [d]));
  });

  it("Parent–teacher conferences has twelve 15-minute one-family slots from 3 to 6 PM", () => {
    const t = getTemplate("parent-teacher-conferences");
    if (!t || t.type !== "SIGNUP_SHEET") throw new Error("missing");
    expect(t.prefill.shifts).toHaveLength(12);
    expect(t.prefill.shifts[0]).toMatchObject({ startTime: "15:00", endTime: "15:15" });
    expect(t.prefill.shifts[11]).toMatchObject({ startTime: "17:45", endTime: "18:00" });
    for (const s of t.prefill.shifts) expect(s.tasks).toEqual([{ title: "Family conference", capacity: 1 }]);
  });

  it("templates resolve in the browser's timezone", () => {
    const t = TEMPLATES[0];
    if (t.type !== "SIGNUP_SHEET") throw new Error("first template should be a sheet");
    expect(signupPrefillFromTemplate(t).details.timezone).toBeNull();
  });

  it("links to the right create flow and to related templates", () => {
    expect(templateCreatePath(getTemplate("potluck")!)).toBe("/create/signup?template=potluck");
    expect(templateCreatePath(getTemplate("book-club")!)).toBe("/create/poll?template=book-club");
    expect(getTemplate("nope")).toBeNull();
    expect(templatePath(getTemplate("potluck")!)).toBe("/signup-sheet/potluck");
    expect(templatePath(getTemplate("book-club")!)).toBe("/meeting-poll/book-club");
    for (const t of TEMPLATES) {
      const related = relatedTemplates(t);
      expect(related).toHaveLength(3);
      expect(related.map((r) => r.slug)).not.toContain(t.slug);
    }
  });

  it("footer links all point at real templates", () => {
    expect(POPULAR_TEMPLATE_LINKS.length).toBeGreaterThanOrEqual(4);
    for (const l of POPULAR_TEMPLATE_LINKS) {
      const t = getTemplate(l.path.split("/").pop());
      expect(t, l.path).not.toBeNull();
      expect(templatePath(t!)).toBe(l.path);
    }
  });

  it("Thursday folders helper runs Thursdays 2:00–2:30 PM through the school year", () => {
    const t = getTemplate("thursday-folders");
    if (!t || t.type !== "SIGNUP_SHEET") throw new Error("missing");
    const at = (today: string) => {
      const r = resolveSignupPrefill(signupPrefillFromTemplate(t), { today, timezone: "UTC" });
      if (isUnsupported(r)) throw new Error(r.reason);
      return { start: r.details.eventDate, dates: expandDates(selectionToSpec(r.dateSel, r.details.eventDate), r.details.eventDate), shift: r.shifts[0] };
    };
    // Mid-autumn: next Thursday until June 15.
    const fall = at("2026-09-25");
    expect(fall.start).toBe("2026-10-01");
    expect(fall.dates[fall.dates.length - 1]).toBe("2027-06-10");
    expect(fall.dates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 4)).toBe(true);
    expect(fall.shift).toMatchObject({ startTime: "14:00", endTime: "14:30" });
    // Spring: still stops in June, not a year later.
    const spring = at("2027-03-01");
    expect(spring.start).toBe("2027-03-04");
    expect(spring.dates[spring.dates.length - 1]).toBe("2027-06-10");
    // Summer: waits for September.
    expect(at("2027-07-10").start).toBe("2027-09-02");
    expect(at("2027-06-14").start).toBe("2027-09-02");
    // Early June: next school year, not a one-week sheet.
    expect(at("2027-06-07").start).toBe("2027-09-02");
    expect(at("2027-06-07").dates.length).toBeGreaterThan(30);
  });

  it("new templates appear in the library and discovery pages without changing the create menu", async () => {
    const slugs = ["snack-schedule", "trunk-or-treat", "food-pantry-shifts", "volunteer", "committee-meeting", "field-trip-chaperones"];
    const library = (await libraryLoader()).data.templates;
    const context = routeContext(testEnv(createSqliteD1()));
    const args = { request: new Request(SITE_URL), url: new URL(SITE_URL), pattern: "/", params: {}, context };
    const sitemap = await (await sitemapLoader(args)).text();
    const llms = await (await llmsLoader(args)).text();
    for (const slug of slugs) {
      const t = getTemplate(slug)!;
      const path = templatePath(t);
      expect(library.find((entry) => entry.slug === slug)?.path).toBe(path);
      expect(loadTemplatePage(slug, t.type).template.createPath).toBe(templateCreatePath(t));
      expect(sitemap).toContain(`<loc>${SITE_URL}${path}</loc>`);
      expect(llms).toContain(`${SITE_URL}${path}`);
    }
    expect(HEADER_MENU_SLUGS).toEqual([
      "book-fair", "meal-train", "parent-teacher-conferences", "staff-appreciation-week", "bake-sale",
      "team-meeting", "family-reunion", "book-club", "happy-hour", "pta-meeting",
    ]);
  });

  it("snack schedule generates eight Saturday games with one family per game", () => {
    const t = getTemplate("snack-schedule");
    if (!t || t.type !== "SIGNUP_SHEET") throw new Error("missing");
    const r = resolveSignupPrefill(signupPrefillFromTemplate(t), { today: "2026-10-01", timezone: "UTC" });
    if (isUnsupported(r)) throw new Error(r.reason);
    const dates = expandDates(selectionToSpec(r.dateSel, r.details.eventDate), r.details.eventDate);
    expect(dates).toHaveLength(8);
    expect(dates[0]).toBe("2026-10-03");
    expect(dates[7]).toBe("2026-11-21");
    expect(dates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 6)).toBe(true);
    const sim = simulateSignupSubmission(r, "2026-10-01");
    if ("error" in sim) throw new Error(sim.error);
    expect(sim.rows).toHaveLength(8);
    expect(sim.rows.every((slot) => slot.capacity === 1)).toBe(true);
  });

  it("food pantry repeats on the first Saturday across year boundaries", () => {
    const t = getTemplate("food-pantry-shifts");
    if (!t || t.type !== "SIGNUP_SHEET") throw new Error("missing");
    const r = resolveSignupPrefill(signupPrefillFromTemplate(t), { today: "2026-10-03", timezone: "UTC" });
    if (isUnsupported(r)) throw new Error(r.reason);
    const dates = expandDates(selectionToSpec(r.dateSel, r.details.eventDate), r.details.eventDate);
    expect(dates).toEqual(["2026-11-07", "2026-12-05", "2027-01-02", "2027-02-06", "2027-03-06", "2027-04-03"]);
    const sim = simulateSignupSubmission(r, "2026-10-03");
    if ("error" in sim) throw new Error(sim.error);
    expect(sim.rows).toHaveLength(30);
  });

  it("field trip gives three groups two chaperone spots for the full trip", () => {
    const t = getTemplate("field-trip-chaperones");
    if (!t || t.type !== "SIGNUP_SHEET") throw new Error("missing");
    const r = resolveSignupPrefill(signupPrefillFromTemplate(t), { today: "2026-10-05", timezone: "UTC" });
    if (isUnsupported(r)) throw new Error(r.reason);
    expect(r.details.eventDate).toBe("2026-10-09");
    expect(r.shifts).toHaveLength(1);
    expect(r.shifts[0]).toMatchObject({ startTime: "09:00", endTime: "14:00" });
    const sim = simulateSignupSubmission(r, "2026-10-05");
    if ("error" in sim) throw new Error(sim.error);
    expect(sim.rows.map((row) => ({ title: row.title, capacity: row.capacity }))).toEqual([
      { title: "Group A chaperone", capacity: 2 },
      { title: "Group B chaperone", capacity: 2 },
      { title: "Group C chaperone", capacity: 2 },
    ]);
  });

  it("header menu lists a short set of real templates", () => {
    const types = HEADER_MENU_SLUGS.map((slug) => getTemplate(slug)?.type);
    expect(types.filter((t) => t === "SIGNUP_SHEET")).toHaveLength(5);
    expect(types.filter((t) => t === "TIME_POLL")).toHaveLength(5);
    for (const slug of HEADER_MENU_SLUGS) expect(getTemplate(slug), slug).not.toBeNull();
  });
});
