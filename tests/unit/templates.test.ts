import { describe, expect, it } from "vitest";
import {
  POPULAR_TEMPLATE_LINKS,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  getTemplate,
  pollPrefillFromTemplate,
  relatedTemplates,
  signupPrefillFromTemplate,
  templateCreatePath,
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
    for (const t of TEMPLATES) {
      const related = relatedTemplates(t);
      expect(related).toHaveLength(3);
      expect(related.map((r) => r.slug)).not.toContain(t.slug);
    }
  });

  it("footer links all point at real templates", () => {
    expect(POPULAR_TEMPLATE_LINKS.length).toBeGreaterThanOrEqual(4);
    for (const l of POPULAR_TEMPLATE_LINKS) {
      expect(getTemplate(l.path.replace("/templates/", "")), l.path).not.toBeNull();
    }
  });
});
