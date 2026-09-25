import { describe, expect, it } from "vitest";
import {
  MAX_SERIES_DAYS,
  addDays,
  dayFilterMatches,
  describeSpec,
  expandDates,
  maxSeriesEnd,
  parseDateSpec,
  parseDayFilter,
  presetsFor,
  readDateSpec,
  serializeDayFilter,
  templateDayFor,
  weekdayOf,
  weekdayOrdinalOf,
  writeDateSpec,
  type DateSpec,
} from "~/utils/recurrence";

// The rules behind multi-day / repeating sheets: which days a sheet covers,
// which days a shift runs on, and the settings round-trip that stores them.
describe("recurrence", () => {
  describe("calendar-day arithmetic", () => {
    it("crosses month, leap-day and year boundaries", () => {
      expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
      expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
      expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
      expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    });

    it("reads the weekday and its ordinal in the month", () => {
      expect(weekdayOf("2026-09-21")).toBe(1); // Monday
      expect(weekdayOrdinalOf("2026-09-21")).toBe(3); // third Monday
      expect(weekdayOrdinalOf("2026-09-29")).toBe(5); // fifth Tuesday -> "last"
    });
  });

  describe("single and range", () => {
    it("single is just the start date", () => {
      expect(expandDates({ mode: "single" }, "2026-11-18")).toEqual(["2026-11-18"]);
    });

    it("range covers every day inclusive", () => {
      expect(expandDates({ mode: "range", end: "2026-11-19" }, "2026-11-17")).toEqual([
        "2026-11-17",
        "2026-11-18",
        "2026-11-19",
      ]);
    });

    it("range ending before the start falls back to one day", () => {
      expect(expandDates({ mode: "range", end: "2026-11-10" }, "2026-11-17")).toEqual([
        "2026-11-17",
      ]);
    });
  });

  describe("weekly", () => {
    it("keeps the weekday across DST changes for a whole school year", () => {
      const dates = expandDates(
        {
          mode: "repeat",
          rule: { type: "weekly", interval: 1, weekdays: [4] },
          ends: { on: "2027-06-15" },
        },
        "2026-09-24",
        400
      );
      expect(dates[0]).toBe("2026-09-24");
      expect(dates.every((d) => weekdayOf(d) === 4)).toBe(true);
      expect(dates[dates.length - 1] <= "2027-06-15").toBe(true);
      // Spans the US DST change on 2026-11-01 without drifting a day.
      expect(dates).toContain("2026-10-29");
      expect(dates).toContain("2026-11-05");
    });

    it("alternates two weekdays", () => {
      const dates = expandDates(
        {
          mode: "repeat",
          rule: { type: "weekly", interval: 1, weekdays: [1, 3] },
          ends: { after: 4 },
        },
        "2026-09-21"
      );
      expect(dates).toEqual(["2026-09-21", "2026-09-23", "2026-09-28", "2026-09-30"]);
    });

    it("every 2 weeks skips the in-between week", () => {
      const dates = expandDates(
        { mode: "repeat", rule: { type: "weekly", interval: 2, weekdays: [1] }, ends: { after: 3 } },
        "2026-09-21"
      );
      expect(dates).toEqual(["2026-09-21", "2026-10-05", "2026-10-19"]);
    });

    it("every weekday skips weekends", () => {
      const dates = expandDates(
        { mode: "repeat", rule: { type: "weekdays" }, ends: { after: 6 } },
        "2026-09-25" // a Friday
      );
      expect(dates).toEqual([
        "2026-09-25",
        "2026-09-28",
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
      ]);
    });
  });

  describe("monthly", () => {
    it("takes the third Monday of every month", () => {
      const dates = expandDates(
        { mode: "repeat", rule: { type: "monthlyNth", interval: 1 }, ends: { after: 5 } },
        "2026-09-21"
      );
      expect(dates).toEqual([
        "2026-09-21",
        "2026-10-19",
        "2026-11-16",
        "2026-12-21",
        "2027-01-18",
      ]);
      expect(dates.every((d) => weekdayOf(d) === 1 && weekdayOrdinalOf(d) === 3)).toBe(true);
    });

    it("treats a fifth weekday as the last one, so no month is skipped", () => {
      const dates = expandDates(
        { mode: "repeat", rule: { type: "monthlyNth", interval: 1 }, ends: { after: 4 } },
        "2026-09-29" // fifth Tuesday of September
      );
      expect(dates).toEqual(["2026-09-29", "2026-10-27", "2026-11-24", "2026-12-29"]);
    });

    it("every 2 months rolls over the year", () => {
      const dates = expandDates(
        { mode: "repeat", rule: { type: "monthlyNth", interval: 2 }, ends: { after: 3 } },
        "2026-11-16"
      );
      expect(dates).toEqual(["2026-11-16", "2027-01-18", "2027-03-15"]);
    });
  });

  describe("ends and limits", () => {
    it("after N produces exactly N days", () => {
      const dates = expandDates(
        {
          mode: "repeat",
          rule: { type: "weekly", interval: 1, weekdays: [2] },
          ends: { after: 13 },
        },
        "2026-09-22"
      );
      expect(dates).toHaveLength(13);
    });

    it("caps the result so an over-long series is detectable", () => {
      const dates = expandDates(
        { mode: "repeat", rule: { type: "daily" }, ends: { on: "2030-01-01" } },
        "2026-09-22",
        61
      );
      expect(dates).toHaveLength(61);
    });

    it("cannot loop forever on an empty weekday list", () => {
      const dates = expandDates(
        {
          mode: "repeat",
          rule: { type: "weekly", interval: 1, weekdays: [] },
          ends: { on: "2027-01-01" },
        },
        "2026-09-22"
      );
      expect(dates).toEqual(["2026-09-22"]);
    });

    it("runs at most one year from the first day", () => {
      expect(maxSeriesEnd("2026-09-22")).toBe("2027-09-22");
      expect(maxSeriesEnd("2028-02-28")).toBe("2029-02-27"); // leap year
      // Twice a week for a school year is 77 days — more than the flat
      // 60-date cap this rule replaced.
      const schoolYear: DateSpec = {
        mode: "repeat",
        rule: { type: "weekly", interval: 1, weekdays: [2, 4] },
        ends: { on: "2027-06-15" },
      };
      const dates = expandDates(schoolYear, "2026-09-22", MAX_SERIES_DAYS + 1);
      expect(dates.length).toBeGreaterThan(60);
      expect(dates[dates.length - 1] <= maxSeriesEnd("2026-09-22")).toBe(true);
    });
  });

  describe("labels and presets", () => {
    it("describes each rule in plain words", () => {
      expect(
        describeSpec(
          {
            mode: "repeat",
            rule: { type: "weekly", interval: 1, weekdays: [4] },
            ends: { after: 2 },
          },
          "2026-09-24"
        )
      ).toBe("Weekly on Thursday");
      expect(
        describeSpec(
          {
            mode: "repeat",
            rule: { type: "weekly", interval: 2, weekdays: [1, 3] },
            ends: { after: 2 },
          },
          "2026-09-21"
        )
      ).toBe("Every 2 weeks on Mon, Wed");
      expect(
        describeSpec(
          { mode: "repeat", rule: { type: "monthlyNth", interval: 1 }, ends: { after: 2 } },
          "2026-09-21"
        )
      ).toBe("Monthly on the third Monday");
    });

    it("writes presets from the chosen date", () => {
      const labels = presetsFor("2026-09-24", "2027-06-15").map((p) => p.label);
      expect(labels).toContain("Weekly on Thursday");
      expect(labels).toContain("Monthly on the fourth Thursday");
      // "Does not repeat" is the One day mode, not a repeat rule.
      expect(labels).not.toContain("Does not repeat");
    });
  });

  describe("shift day filters", () => {
    it("parses, matches and round-trips", () => {
      expect(parseDayFilter("all")).toBeNull();
      expect(parseDayFilter("")).toBeNull();

      const dates = parseDayFilter("2026-11-17,2026-11-19");
      expect(dates).toEqual({ kind: "dates", values: ["2026-11-17", "2026-11-19"] });
      expect(dayFilterMatches(dates, "2026-11-17")).toBe(true);
      expect(dayFilterMatches(dates, "2026-11-18")).toBe(false);

      const weekdays = parseDayFilter("w1,w3");
      expect(weekdays).toEqual({ kind: "weekdays", values: [1, 3] });
      expect(dayFilterMatches(weekdays, "2026-09-21")).toBe(true);
      expect(dayFilterMatches(weekdays, "2026-09-22")).toBe(false);

      expect(serializeDayFilter(weekdays)).toBe("w1,w3");
      expect(serializeDayFilter(null)).toBe("all");
      expect(dayFilterMatches(null, "2026-09-22")).toBe(true);
    });
  });

  describe("settings round-trip", () => {
    it("merges into existing settings without losing other keys", () => {
      const spec: DateSpec = {
        mode: "repeat",
        rule: { type: "weekly", interval: 1, weekdays: [4] },
        ends: { on: "2027-06-15" },
      };
      const json = writeDateSpec('{"somethingElse":true}', spec);
      expect(JSON.parse(json).somethingElse).toBe(true);
      expect(readDateSpec(json)).toEqual(spec);
    });

    it("clears the stored spec for a one-day sheet", () => {
      const json = writeDateSpec('{"dates":{"mode":"range","end":"2026-11-19"},"keep":1}', {
        mode: "single",
      });
      expect(JSON.parse(json)).toEqual({ keep: 1 });
      expect(readDateSpec(json)).toEqual({ mode: "single" });
    });

    it("reads legacy and malformed settings as single-day", () => {
      expect(readDateSpec("{}")).toEqual({ mode: "single" });
      expect(readDateSpec(null)).toEqual({ mode: "single" });
      expect(readDateSpec("not json")).toEqual({ mode: "single" });
      expect(readDateSpec('{"dates":{"mode":"repeat"}}')).toEqual({ mode: "single" });
    });
  });

  describe("form parsing", () => {
    const form = (values: Record<string, string>) => (name: string) =>
      name in values ? values[name] : null;

    it("parses a range", () => {
      expect(parseDateSpec(form({ dateMode: "range", dateEnd: "2026-11-19" }), "2026-11-17")).toEqual(
        { spec: { mode: "range", end: "2026-11-19" } }
      );
    });

    it("rejects a bad range", () => {
      expect(parseDateSpec(form({ dateMode: "range", dateEnd: "nope" }), "2026-11-17")).toHaveProperty(
        "error"
      );
      expect(
        parseDateSpec(form({ dateMode: "range", dateEnd: "2026-11-01" }), "2026-11-17")
      ).toHaveProperty("error");
    });

    it("falls back to the start weekday when none is posted", () => {
      const out = parseDateSpec(
        form({ dateMode: "repeat", repeatType: "weekly", repeatEndDate: "2027-06-15" }),
        "2026-09-24"
      );
      expect(out).toHaveProperty("spec");
      expect((out as { spec: DateSpec }).spec).toMatchObject({
        rule: { type: "weekly", interval: 1, weekdays: [4] },
      });
    });

    it("rejects a missing or impossible end", () => {
      expect(
        parseDateSpec(form({ dateMode: "repeat", repeatType: "weekly" }), "2026-09-24")
      ).toHaveProperty("error");
      expect(
        parseDateSpec(
          form({
            dateMode: "repeat",
            repeatType: "weekly",
            repeatEndMode: "after",
            repeatCount: "0",
          }),
          "2026-09-24"
        )
      ).toHaveProperty("error");
    });

    it("treats missing fields as a plain one-day sheet", () => {
      expect(parseDateSpec(form({}), "2026-09-24")).toEqual({ spec: { mode: "single" } });
    });
  });
});

// Days added to a live sheet from the editor copy an existing day's tasks.
describe("templateDayFor", () => {
  // Mon/Wed series starting Wed Oct 7 2026: Wed 7, Mon 12, Wed 14, Mon 19.
  const series = ["2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19"];

  it("copies the closest day on the same weekday", () => {
    expect(templateDayFor(series, "2026-10-26")).toBe("2026-10-19"); // Monday
    expect(templateDayFor(series, "2026-10-21")).toBe("2026-10-14"); // Wednesday
  });

  it("works when the new day is before the series (start moved earlier)", () => {
    expect(templateDayFor(series, "2026-10-05")).toBe("2026-10-12"); // Monday
  });

  it("falls back to the closest earlier day when no weekday matches", () => {
    // Mon–Wed range extended to Thursday.
    expect(templateDayFor(["2026-11-16", "2026-11-17", "2026-11-18"], "2026-11-19")).toBe("2026-11-18");
  });

  it("falls back to the closest day when nothing is earlier either", () => {
    expect(templateDayFor(["2026-11-17", "2026-11-18"], "2026-11-13")).toBe("2026-11-17");
  });

  it("returns null when there is nothing to copy", () => {
    expect(templateDayFor([], "2026-11-13")).toBeNull();
  });
});
