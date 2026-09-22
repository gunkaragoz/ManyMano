// Unit tests for the date-spec expansion used by multi-day / repeating sheets.
// Plain node + assert, in the style of tests/test-flow.js. Run: node tests/recurrence.mjs
import assert from "node:assert";
import {
  addDays,
  dayFilterMatches,
  describeSpec,
  expandDates,
  parseDateSpec,
  parseDayFilter,
  presetsFor,
  readDateSpec,
  serializeDayFilter,
  weekdayOf,
  weekdayOrdinalOf,
  writeDateSpec,
} from "../app/utils/recurrence.ts";

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("\n--- Calendar-day arithmetic ---");
check("crosses a month boundary", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});
check("weekday and ordinal of a date", () => {
  assert.equal(weekdayOf("2026-09-21"), 1); // Monday
  assert.equal(weekdayOrdinalOf("2026-09-21"), 3); // third Monday
  assert.equal(weekdayOrdinalOf("2026-09-29"), 5); // fifth Tuesday -> "last"
});

console.log("\n--- Single and range ---");
check("single is just the start date", () => {
  assert.deepEqual(expandDates({ mode: "single" }, "2026-11-18"), ["2026-11-18"]);
});
check("range covers every day inclusive", () => {
  assert.deepEqual(expandDates({ mode: "range", end: "2026-11-19" }, "2026-11-17"), [
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
  ]);
});
check("range ending before the start falls back to one day", () => {
  assert.deepEqual(expandDates({ mode: "range", end: "2026-11-10" }, "2026-11-17"), ["2026-11-17"]);
});

console.log("\n--- Weekly ---");
check("weekly on Thursday keeps the weekday all the way to June", () => {
  const dates = expandDates(
    { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [4] }, ends: { on: "2027-06-15" } },
    "2026-09-24",
    400
  );
  assert.equal(dates[0], "2026-09-24");
  assert.ok(dates.every((d) => weekdayOf(d) === 4), "every date is a Thursday");
  assert.ok(dates[dates.length - 1] <= "2027-06-15");
  // Spans the US DST change on 2026-11-01 without drifting a day.
  assert.ok(dates.includes("2026-10-29") && dates.includes("2026-11-05"));
});
check("two weekdays alternate correctly", () => {
  const dates = expandDates(
    { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [1, 3] }, ends: { after: 4 } },
    "2026-09-21"
  );
  assert.deepEqual(dates, ["2026-09-21", "2026-09-23", "2026-09-28", "2026-09-30"]);
});
check("every 2 weeks skips the in-between week", () => {
  const dates = expandDates(
    { mode: "repeat", rule: { type: "weekly", interval: 2, weekdays: [1] }, ends: { after: 3 } },
    "2026-09-21"
  );
  assert.deepEqual(dates, ["2026-09-21", "2026-10-05", "2026-10-19"]);
});
check("weekdays rule skips weekends", () => {
  const dates = expandDates(
    { mode: "repeat", rule: { type: "weekdays" }, ends: { after: 6 } },
    "2026-09-25" // a Friday
  );
  assert.deepEqual(dates, [
    "2026-09-25",
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
  ]);
});

console.log("\n--- Monthly ---");
check("third Monday of every month", () => {
  const dates = expandDates(
    { mode: "repeat", rule: { type: "monthlyNth", interval: 1 }, ends: { after: 5 } },
    "2026-09-21"
  );
  assert.deepEqual(dates, ["2026-09-21", "2026-10-19", "2026-11-16", "2026-12-21", "2027-01-18"]);
  assert.ok(dates.every((d) => weekdayOf(d) === 1 && weekdayOrdinalOf(d) === 3));
});
check("a fifth weekday means the last one, so no month is skipped", () => {
  const dates = expandDates(
    { mode: "repeat", rule: { type: "monthlyNth", interval: 1 }, ends: { after: 4 } },
    "2026-09-29" // fifth Tuesday of September
  );
  assert.deepEqual(dates, ["2026-09-29", "2026-10-27", "2026-11-24", "2026-12-29"]);
});
check("every 2 months rolls over the year", () => {
  const dates = expandDates(
    { mode: "repeat", rule: { type: "monthlyNth", interval: 2 }, ends: { after: 3 } },
    "2026-11-16"
  );
  assert.deepEqual(dates, ["2026-11-16", "2027-01-18", "2027-03-15"]);
});

console.log("\n--- Ends and limits ---");
check("after N produces exactly N dates", () => {
  const dates = expandDates(
    { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [2] }, ends: { after: 13 } },
    "2026-09-22"
  );
  assert.equal(dates.length, 13);
});
check("max caps the result so an over-long series is detectable", () => {
  const dates = expandDates(
    { mode: "repeat", rule: { type: "daily" }, ends: { on: "2030-01-01" } },
    "2026-09-22",
    61
  );
  assert.equal(dates.length, 61);
});
check("an empty weekday list cannot loop forever", () => {
  const dates = expandDates(
    { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [] }, ends: { on: "2027-01-01" } },
    "2026-09-22"
  );
  assert.deepEqual(dates, ["2026-09-22"]);
});

console.log("\n--- Labels and presets ---");
check("describes each rule in plain words", () => {
  assert.equal(
    describeSpec({ mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [4] }, ends: { after: 2 } }, "2026-09-24"),
    "Weekly on Thursday"
  );
  assert.equal(
    describeSpec({ mode: "repeat", rule: { type: "weekly", interval: 2, weekdays: [1, 3] }, ends: { after: 2 } }, "2026-09-21"),
    "Every 2 weeks on Mon, Wed"
  );
  assert.equal(
    describeSpec({ mode: "repeat", rule: { type: "monthlyNth", interval: 1 }, ends: { after: 2 } }, "2026-09-21"),
    "Monthly on the third Monday"
  );
});
check("presets are written from the chosen date", () => {
  const labels = presetsFor("2026-09-24", "2027-06-15").map((p) => p.label);
  assert.ok(labels.includes("Weekly on Thursday"));
  assert.ok(labels.includes("Monthly on the fourth Thursday"));
});

console.log("\n--- Shift day filters ---");
check("parses, matches and round-trips", () => {
  assert.equal(parseDayFilter("all"), null);
  assert.equal(parseDayFilter(""), null);
  const dates = parseDayFilter("2026-11-17,2026-11-19");
  assert.deepEqual(dates, { kind: "dates", values: ["2026-11-17", "2026-11-19"] });
  assert.ok(dayFilterMatches(dates, "2026-11-17"));
  assert.ok(!dayFilterMatches(dates, "2026-11-18"));
  const weekdays = parseDayFilter("w1,w3");
  assert.deepEqual(weekdays, { kind: "weekdays", values: [1, 3] });
  assert.ok(dayFilterMatches(weekdays, "2026-09-21"));
  assert.ok(!dayFilterMatches(weekdays, "2026-09-22"));
  assert.equal(serializeDayFilter(weekdays), "w1,w3");
  assert.equal(serializeDayFilter(null), "all");
  assert.ok(dayFilterMatches(null, "2026-09-22"), "no filter means every date");
});

console.log("\n--- settings JSON round-trip ---");
check("merges into existing settings and never loses other keys", () => {
  const spec = { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [4] }, ends: { on: "2027-06-15" } };
  const json = writeDateSpec('{"somethingElse":true}', spec);
  assert.equal(JSON.parse(json).somethingElse, true);
  assert.deepEqual(readDateSpec(json), spec);
});
check("single clears the stored spec", () => {
  const json = writeDateSpec('{"dates":{"mode":"range","end":"2026-11-19"},"keep":1}', { mode: "single" });
  assert.deepEqual(JSON.parse(json), { keep: 1 });
  assert.deepEqual(readDateSpec(json), { mode: "single" });
});
check("legacy and malformed settings read as single-day", () => {
  assert.deepEqual(readDateSpec("{}"), { mode: "single" });
  assert.deepEqual(readDateSpec(null), { mode: "single" });
  assert.deepEqual(readDateSpec("not json"), { mode: "single" });
  assert.deepEqual(readDateSpec('{"dates":{"mode":"repeat"}}'), { mode: "single" });
});

console.log("\n--- Form parsing ---");
const form = (values) => (name) => (name in values ? values[name] : null);
check("parses a range", () => {
  assert.deepEqual(parseDateSpec(form({ dateMode: "range", dateEnd: "2026-11-19" }), "2026-11-17"), {
    spec: { mode: "range", end: "2026-11-19" },
  });
});
check("rejects a bad range", () => {
  assert.ok("error" in parseDateSpec(form({ dateMode: "range", dateEnd: "nope" }), "2026-11-17"));
  assert.ok("error" in parseDateSpec(form({ dateMode: "range", dateEnd: "2026-11-01" }), "2026-11-17"));
});
check("weekly with no weekdays falls back to the start weekday", () => {
  const out = parseDateSpec(
    form({ dateMode: "repeat", repeatType: "weekly", repeatEndDate: "2027-06-15" }),
    "2026-09-24"
  );
  assert.deepEqual(out.spec.rule, { type: "weekly", interval: 1, weekdays: [4] });
});
check("rejects a missing or bad end", () => {
  assert.ok("error" in parseDateSpec(form({ dateMode: "repeat", repeatType: "weekly" }), "2026-09-24"));
  assert.ok(
    "error" in
      parseDateSpec(
        form({ dateMode: "repeat", repeatType: "weekly", repeatEndMode: "after", repeatCount: "0" }),
        "2026-09-24"
      )
  );
});
check("missing fields mean a plain single-day sheet", () => {
  assert.deepEqual(parseDateSpec(form({}), "2026-09-24"), { spec: { mode: "single" } });
});

console.log(`\n${passed} checks passed.\n`);
