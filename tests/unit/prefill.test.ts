import { describe, expect, it } from "vitest";
import {
  isUnsupported,
  materializeSignup,
  pollPrefillFromEvent,
  resolveAnchor,
  resolvePollPrefill,
  resolveSignupPrefill,
  signupPageView,
  signupPrefillFromEvent,
  simulateSignupSubmission,
  type PollPrefill,
  type ResolvedSignup,
  type SignupPrefill,
  type SignupShift,
  type SimulatedSlotRow,
  type SourceEvent,
  type SourceSlot,
} from "~/utils/prefill";
import { defaultSelection, selectionFromSpec, selectionToSpec, type DateSelection } from "~/utils/formDates";
import { expandDates, weekdayOf, writeDateSpec, type DateSpec } from "~/utils/recurrence";
import { pollDefaultTitle } from "~/utils/pollTitles";

const TODAY = "2026-09-25"; // Friday

// ---------------------------------------------------------------------------
// Fixture helpers: build a sheet the way the create action would have stored
// it, then edit it the way the event page's editor can.
// ---------------------------------------------------------------------------

function shift(id: number, name: string, startTime: string, endTime: string, tasks: Array<[string, number]>, days: string[] | null = null): SignupShift {
  return { id, name, startTime, endTime, days, tasks: tasks.map(([title, capacity], j) => ({ id: id * 100 + j, title, capacity })) };
}

function created(spec: DateSpec, start: string, shifts: SignupShift[]): { event: SourceEvent; slots: SourceSlot[] } {
  const dateSel: DateSelection = spec.mode === "single" ? defaultSelection(start) : selectionFromSpec(spec, start);
  const state = {
    details: { title: "Book fair", eventDate: start, description: "Help out!", location: "Library", organizerName: "Ann", organizerEmail: "ann@example.com", timezone: "America/New_York" },
    shifts,
    dateSel,
  };
  const sim = simulateSignupSubmission(state, start);
  if ("error" in sim) throw new Error(sim.error);
  return {
    event: {
      id: "evt123",
      type: "SIGNUP_SHEET",
      title: "Book fair",
      description: "Help out!",
      location: "Library",
      eventDate: start,
      timezone: "America/New_York",
      durationMinutes: null,
      settings: writeDateSpec(null, spec),
    },
    slots: sim.rows.map((r, i) => ({
      id: `s${String(i).padStart(3, "0")}`,
      title: r.title,
      shiftName: r.shiftName || null,
      capacity: r.capacity,
      slotDate: spec.mode === "single" ? null : r.date,
      startTime: r.startTime || null,
      endTime: r.endTime || null,
      displayOrder: i,
    })),
  };
}

function rowsOf(slots: SourceSlot[], eventDate: string | null): SimulatedSlotRow[] {
  return [...slots]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((s) => ({
      date: s.slotDate || eventDate || "",
      shiftName: s.shiftName || "",
      startTime: s.startTime || "",
      endTime: s.endTime || "",
      title: s.title,
      capacity: s.capacity,
    }));
}

function copy(event: SourceEvent, slots: SourceSlot[]): SignupPrefill {
  const result = signupPrefillFromEvent(event, slots);
  if (isUnsupported(result)) throw new Error(`unexpectedly unsupported: ${result.reason}`);
  return result.prefill;
}

function resolveOk(p: SignupPrefill, today = TODAY, timezone = "America/New_York"): ResolvedSignup {
  const r = resolveSignupPrefill(p, { today, timezone });
  if (isUnsupported(r)) throw new Error(`unexpectedly unsupported: ${r.reason}`);
  return r;
}

const RANGE_MON_FRI: DateSpec = { mode: "range", end: "2026-11-20" }; // Mon 16 – Fri 20 Nov

// ---------------------------------------------------------------------------

describe("anchors", () => {
  it("weekday anchors start strictly after today when minOffset is 1", () => {
    expect(resolveAnchor({ kind: "weekday", weekday: 5, minOffsetDays: 1 }, TODAY)).toBe("2026-10-02");
    expect(resolveAnchor({ kind: "weekday", weekday: 5, minOffsetDays: 0 }, TODAY)).toBe(TODAY);
    expect(resolveAnchor({ kind: "weekday", weekday: 1, minOffsetDays: 1 }, TODAY)).toBe("2026-09-28");
  });

  it("offset and undated anchors", () => {
    expect(resolveAnchor({ kind: "offset", offsetDays: 3 }, TODAY)).toBe("2026-09-28");
    expect(resolveAnchor({ kind: "undated" }, TODAY)).toBe("");
  });

  it("crosses month and year boundaries and leap days", () => {
    expect(resolveAnchor({ kind: "weekday", weekday: 1, minOffsetDays: 1 }, "2026-12-31")).toBe("2027-01-04");
    expect(resolveAnchor({ kind: "offset", offsetDays: 1 }, "2028-02-28")).toBe("2028-02-29");
    expect(resolveAnchor({ kind: "offset", offsetDays: 1 }, "2027-02-28")).toBe("2027-03-01");
  });

  it("a fifth-weekday anchor skips months that don't have one", () => {
    // Oct 2026 has four Mondays; the next fifth Monday is Nov 30.
    expect(resolveAnchor({ kind: "monthlyNth", weekday: 1, ordinal: 5, minOffsetDays: 1 }, TODAY)).toBe("2026-11-30");
    expect(resolveAnchor({ kind: "monthlyNth", weekday: 2, ordinal: 3, minOffsetDays: 1 }, TODAY)).toBe("2026-10-20");
  });
});

describe("copying a sign-up sheet", () => {
  it("copies a single-day sheet onto the next same weekday, with no organizer", () => {
    const { event, slots } = created({ mode: "single" }, "2026-10-17", [
      shift(1, "Morning", "08:30", "10:30", [["Setup", 2], ["Check-in", 1]]),
      shift(2, "Midday", "10:30", "12:30", [["Snacks", 3]]),
    ]);
    const p = copy(event, slots);
    expect(p.anchor).toEqual({ kind: "weekday", weekday: 6, minOffsetDays: 1 });
    const r = resolveOk(p);
    expect(r.details.eventDate).toBe("2026-09-26"); // next Saturday
    expect(r.details.organizerName).toBe("");
    expect(r.details.organizerEmail).toBe("");
    expect(r.details.timezone).toBe("America/New_York");
    expect(r.dateSel.mode).toBe("single");
    expect(r.shifts.map((s) => [s.name, s.startTime, s.endTime, s.days, s.tasks.map((t) => [t.title, t.capacity])])).toEqual([
      ["Morning", "08:30", "10:30", null, [["Setup", 2], ["Check-in", 1]]],
      ["Midday", "10:30", "12:30", null, [["Snacks", 3]]],
    ]);
  });

  it("keeps an undated sheet undated (the form then defaults to today)", () => {
    const { event, slots } = created({ mode: "single" }, "2026-10-17", [shift(1, "", "", "", [["Bring chips", 4]])]);
    const p = copy({ ...event, eventDate: null }, slots);
    expect(p.anchor).toEqual({ kind: "undated" });
    const r = resolveOk(p);
    expect(r.details.eventDate).toBe("");
    expect(r.shifts[0].tasks[0].title).toBe("Bring chips");
  });

  it("copies a range with a shift limited to some days, moving those days along", () => {
    const { event, slots } = created(RANGE_MON_FRI, "2026-11-16", [
      shift(1, "Setup", "07:00", "08:00", [["Tables", 3]], ["2026-11-16"]),
      shift(2, "Sales", "08:00", "15:00", [["Cashier", 2], ["Helper", 3]]),
      shift(3, "Teardown", "15:00", "16:00", [["Pack up", 4]], ["2026-11-20"]),
    ]);
    const p = copy(event, slots);
    expect(p.dates).toEqual({ mode: "range", spanDays: 5 });
    expect(p.shifts.map((s) => s.days)).toEqual([
      { kind: "dateOffsets", values: [0] },
      { kind: "all" },
      { kind: "dateOffsets", values: [4] },
    ]);
    const r = resolveOk(p);
    expect(r.details.eventDate).toBe("2026-09-28"); // next Monday
    expect(r.dateSel).toMatchObject({ mode: "range", end: "2026-10-02" });
    expect(r.shifts[0].days).toEqual(["2026-09-28"]);
    expect(r.shifts[2].days).toEqual(["2026-10-02"]);
  });

  it("copies a repeat with a shift on only one of its weekdays", () => {
    const spec: DateSpec = { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [2, 4] }, ends: { after: 8 } };
    const { event, slots } = created(spec, "2026-10-06", [
      shift(1, "Practice", "16:00", "17:30", [["Coach", 1]]),
      shift(2, "Snack", "17:30", "18:00", [["Snack parent", 1]], ["w4"]),
    ]);
    const p = copy(event, slots);
    expect(p.shifts[1].days).toEqual({ kind: "weekdays", values: [4] });
    const r = resolveOk(p);
    expect(weekdayOf(r.details.eventDate)).toBe(2);
    expect(r.details.eventDate).toBe("2026-09-29");
    expect(r.shifts[1].days).toEqual(["w4"]);
    expect(selectionToSpec(r.dateSel, r.details.eventDate)).toEqual(spec);
  });

  it("keeps duplicate same-named tasks and their spots", () => {
    const { event, slots } = created({ mode: "single" }, "2026-10-17", [
      shift(1, "Carpool", "07:30", "08:00", [["Driver", 1], ["Driver", 1], ["Navigator", 2]]),
    ]);
    const r = resolveOk(copy(event, slots));
    expect(r.shifts[0].tasks.map((t) => t.title)).toEqual(["Driver", "Driver", "Navigator"]);
  });

  it("survives editor edits that keep the pattern (a shift appended to every day)", () => {
    const { event, slots } = created(RANGE_MON_FRI, "2026-11-16", [shift(1, "Sales", "08:00", "15:00", [["Cashier", 2]])]);
    // The editor appends new rows after every existing one.
    const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
    const appended = days.map((d, i) => ({
      id: `z${i}`, title: "Cleanup", shiftName: "Close", capacity: 2, slotDate: d, startTime: "15:00", endTime: "16:00", displayOrder: 100 + i,
    }));
    const p = copy(event, [...slots, ...appended]);
    expect(p.shifts.map((s) => s.name)).toEqual(["Sales", "Close"]);
  });

  it("copies a task the organizer added to just one day of a range", () => {
    const { event, slots } = created(RANGE_MON_FRI, "2026-11-16", [shift(1, "Sales", "08:00", "15:00", [["Cashier", 2]])]);
    const extra = { id: "z1", title: "Author visit host", shiftName: "Sales", capacity: 1, slotDate: "2026-11-18", startTime: "08:00", endTime: "15:00", displayOrder: 99 };
    const p = copy(event, [...slots, extra]);
    expect(p.shifts).toHaveLength(2);
    expect(p.shifts[1]).toMatchObject({ name: "Sales", days: { kind: "dateOffsets", values: [2] } });
  });

  it("copies a scheduled day that has no tasks", () => {
    const { event, slots } = created(RANGE_MON_FRI, "2026-11-16", [
      shift(1, "Sales", "08:00", "15:00", [["Cashier", 2]], ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]),
    ]);
    const p = copy(event, slots);
    expect(p.dates).toEqual({ mode: "range", spanDays: 5 });
    expect(p.shifts[0].days).toEqual({ kind: "dateOffsets", values: [0, 1, 2, 3] });
  });

  it("refuses a repeat exception (a task removed from one date)", () => {
    const spec: DateSpec = { mode: "repeat", rule: { type: "weekly", interval: 1, weekdays: [2, 4] }, ends: { after: 6 } };
    const { event, slots } = created(spec, "2026-10-06", [shift(1, "Practice", "16:00", "17:30", [["Coach", 1]])]);
    const r = signupPrefillFromEvent(event, slots.filter((s) => s.slotDate !== "2026-10-13"));
    expect(isUnsupported(r) && r.reason).toMatch(/skip dates/);
  });

  it("refuses spots that differ between days", () => {
    const { event, slots } = created(RANGE_MON_FRI, "2026-11-16", [shift(1, "Sales", "08:00", "15:00", [["Cashier", 2]])]);
    const edited = slots.map((s) => (s.slotDate === "2026-11-18" ? { ...s, capacity: 5 } : s));
    const r = signupPrefillFromEvent(event, edited);
    expect(isUnsupported(r) && r.reason).toMatch(/different number of spots/);
  });

  it("refuses tasks in a different order on different days", () => {
    const { event, slots } = created(RANGE_MON_FRI, "2026-11-16", [shift(1, "Sales", "08:00", "15:00", [["A", 1], ["B", 1]])]);
    const edited = slots.map((s) =>
      s.slotDate === "2026-11-17" ? { ...s, displayOrder: s.title === "A" ? 1000 : 999 } : s
    );
    const r = signupPrefillFromEvent(event, edited);
    expect(isUnsupported(r) && r.reason).toMatch(/different order/);
  });

  it("refuses a partial task on a range longer than 31 days", () => {
    const spec: DateSpec = { mode: "range", end: "2026-12-31" };
    const { event, slots } = created(spec, "2026-11-01", [shift(1, "Daily", "09:00", "10:00", [["Greeter", 1]])]);
    const r = signupPrefillFromEvent(event, slots.filter((s) => s.slotDate !== "2026-11-05"));
    expect(isUnsupported(r) && r.reason).toMatch(/longer than 31 days/);
  });

  it("refuses more task definitions than the form allows", () => {
    // 32 tasks, each on a different single day: 32 definitions after splitting.
    const spec: DateSpec = { mode: "range", end: "2026-11-30" };
    const { event, slots } = created(spec, "2026-11-01", [shift(1, "Day", "09:00", "10:00", [["Base", 1]])]);
    const extras = Array.from({ length: 31 }, (_, i) => ({
      id: `x${String(i).padStart(2, "0")}`, title: `Extra ${i}`, shiftName: "Day", capacity: 1,
      slotDate: `2026-11-${String(i % 30 + 1).padStart(2, "0")}`, startTime: "09:00", endTime: "10:00", displayOrder: 500 + i,
    }));
    const r = signupPrefillFromEvent(event, [...slots, ...extras]);
    expect(isUnsupported(r) && r.reason).toMatch(/more than 31 different tasks/);
  });

  it("refuses days outside the stored schedule", () => {
    const { event, slots } = created(RANGE_MON_FRI, "2026-11-16", [shift(1, "Sales", "08:00", "15:00", [["Cashier", 2]])]);
    const stray = { ...slots[0], id: "zz", slotDate: "2026-11-25", displayOrder: 99 };
    const r = signupPrefillFromEvent(event, [...slots, stray]);
    expect(isUnsupported(r) && r.reason).toMatch(/outside its schedule/);
  });

  it("round-trips at the original anchor as the same page view", () => {
    const spec: DateSpec = { mode: "repeat", rule: { type: "weekly", interval: 2, weekdays: [1, 3] }, ends: { on: "2026-12-30" } };
    const { event, slots } = created(spec, "2026-10-05", [
      shift(1, "Early", "07:00", "08:00", [["Open", 1], ["Open", 1]]),
      shift(2, "Late", "18:00", "19:00", [["Close", 2]], ["w3"]),
    ]);
    const p = copy(event, slots);
    const state = materializeSignup(p, "2026-10-05", "America/New_York", "2026-10-05");
    const sim = simulateSignupSubmission(state, "2026-10-05");
    if ("error" in sim) throw new Error(sim.error);
    expect(signupPageView(sim.rows)).toBe(signupPageView(rowsOf(slots, event.eventDate)));
  });
});

describe("moving repeating dates", () => {
  it("regression: a last-Monday series from Aug 31 re-anchors to Nov 30, not Sep 28", () => {
    const spec: DateSpec = { mode: "repeat", rule: { type: "monthlyNth", interval: 1 }, ends: { after: 6 } };
    const { event, slots } = created(spec, "2026-08-31", [shift(1, "Meeting", "19:00", "20:00", [["Notes", 1]])]);
    const p = copy(event, slots);
    expect(p.anchor).toEqual({ kind: "monthlyNth", weekday: 1, ordinal: 5, minOffsetDays: 1 });
    const r = resolveOk(p, "2026-09-25");
    expect(r.details.eventDate).toBe("2026-11-30");
    const dates = expandDates(selectionToSpec(r.dateSel, r.details.eventDate), r.details.eventDate);
    // Last Monday of every month, including 4-Monday months.
    expect(dates).toEqual(["2026-11-30", "2026-12-28", "2027-01-25", "2027-02-22", "2027-03-29", "2027-04-26"]);
  });

  it("a third-Tuesday series every 2 months keeps its ordinal and interval", () => {
    const spec: DateSpec = { mode: "repeat", rule: { type: "monthlyNth", interval: 2 }, ends: { on: "2026-12-31" } };
    const { event, slots } = created(spec, "2026-01-20", [shift(1, "Board", "18:00", "19:00", [["Chair", 1]])]);
    const r = resolveOk(copy(event, slots), "2026-09-25");
    expect(r.details.eventDate).toBe("2026-10-20");
    const newSpec = selectionToSpec(r.dateSel, r.details.eventDate);
    expect(newSpec).toMatchObject({ rule: { type: "monthlyNth", interval: 2 } });
    // Date end keeps its distance from the first date.
    expect(newSpec).toMatchObject({ ends: { on: "2027-09-30" } }); // 345 days, as before
  });

  it("weekly every-2-weeks keeps the original start weekday", () => {
    const spec: DateSpec = { mode: "repeat", rule: { type: "weekly", interval: 2, weekdays: [4] }, ends: { after: 5 } };
    const { event, slots } = created(spec, "2026-10-08", [shift(1, "Club", "15:00", "16:00", [["Helper", 2]])]);
    const r = resolveOk(copy(event, slots));
    expect(weekdayOf(r.details.eventDate)).toBe(4);
    expect(expandDates(selectionToSpec(r.dateSel, r.details.eventDate), r.details.eventDate)).toHaveLength(5);
  });

  it("refuses a move that would break the one-year limit", () => {
    // A date-bounded monthly series near the 365-day edge can't grow past it,
    // but an out-of-range prefill must be reported, never clamped.
    const p: SignupPrefill = {
      source: { kind: "template", slug: "x", name: "X" },
      details: { title: "X", description: "", location: "", timezone: null },
      anchor: { kind: "offset", offsetDays: 1 },
      dates: { mode: "range", spanDays: 400 },
      shifts: [{ name: "", startTime: "", endTime: "", days: { kind: "all" }, tasks: [{ title: "Help", capacity: 1 }] }],
    };
    const r = resolveSignupPrefill(p, { today: TODAY, timezone: "UTC" });
    expect(isUnsupported(r)).toBe(true);
  });
});

describe("copying a meeting poll", () => {
  const pollEvent = (over: Partial<SourceEvent> = {}): SourceEvent => ({
    id: "poll1", type: "TIME_POLL", title: "Team lunch", description: null, location: "Cafe",
    eventDate: "2026-09-01", timezone: "Europe/Berlin", durationMinutes: 60, settings: "{}", ...over,
  });
  const opt = (i: number, date: string, start: string | null, end: string | null, title?: string): SourceSlot => ({
    id: `o${i}`, title: title ?? pollDefaultTitle(date, start, end), shiftName: null, capacity: 999,
    slotDate: date, startTime: start, endTime: end, displayOrder: i,
  });

  it("keeps offsets, times and custom labels; blanks generated titles", () => {
    const r = pollPrefillFromEvent(pollEvent(), [
      opt(0, "2026-09-01", "12:00", "13:00"),
      opt(1, "2026-09-03", "12:30", "13:30", "Thursday (pizza)"),
      opt(2, "2026-09-01", "13:00", "14:00"),
    ]);
    if (isUnsupported(r)) throw new Error(r.reason);
    expect(r.prefill.anchor).toEqual({ kind: "weekday", weekday: 2, minOffsetDays: 1 });
    expect(r.prefill.options).toEqual([
      { dayOffset: 0, startTime: "12:00", label: "" },
      { dayOffset: 2, startTime: "12:30", label: "Thursday (pizza)" },
      { dayOffset: 0, startTime: "13:00", label: "" },
    ]);
    const resolved = resolvePollPrefill(r.prefill, { today: TODAY, timezone: "Europe/Berlin" });
    if (isUnsupported(resolved)) throw new Error(resolved.reason);
    expect(resolved.days.map((d) => [d.date, d.startTime, d.label])).toEqual([
      ["2026-09-29", "12:00", ""],
      ["2026-10-01", "12:30", "Thursday (pizza)"],
      ["2026-09-29", "13:00", ""],
    ]);
    expect(resolved.durationMinutes).toBe(60);
    expect(resolved.details.timezone).toBe("Europe/Berlin");
    expect(resolved.details.organizerName).toBe("");
  });

  it("treats a custom label that matches the generated default as generated", () => {
    const r = pollPrefillFromEvent(pollEvent(), [opt(0, "2026-09-01", "12:00", "13:00", pollDefaultTitle("2026-09-01", "12:00", "13:00"))]);
    if (isUnsupported(r)) throw new Error(r.reason);
    expect(r.prefill.options[0].label).toBe("");
  });

  it("copies an all-day poll as 1 hour and says so", () => {
    const r = pollPrefillFromEvent(pollEvent({ durationMinutes: null }), [
      opt(0, "2026-09-05", null, null),
      opt(1, "2026-09-06", null, null, "Sunday brunch"),
    ]);
    if (isUnsupported(r)) throw new Error(r.reason);
    expect(r.prefill.durationMinutes).toBe(60);
    expect(r.prefill.notes).toEqual(["allDayToHour"]);
    expect(r.prefill.options).toEqual([
      { dayOffset: 0, startTime: "10:00", label: "" },
      { dayOffset: 1, startTime: "10:00", label: "Sunday brunch" },
    ]);
  });

  it("refuses two all-day options on the same day", () => {
    const r = pollPrefillFromEvent(pollEvent({ durationMinutes: null }), [
      opt(0, "2026-09-05", null, null),
      opt(1, "2026-09-05", null, null, "again"),
    ]);
    expect(isUnsupported(r) && r.reason).toMatch(/same day and time/);
  });

  it("reads the duration of an older poll off its options", () => {
    const r = pollPrefillFromEvent(pollEvent({ durationMinutes: null }), [opt(0, "2026-09-01", "09:00", "10:30")]);
    if (isUnsupported(r)) throw new Error(r.reason);
    expect(r.prefill.durationMinutes).toBe(90);
  });

  it("refuses an end time that contradicts the duration", () => {
    const r = pollPrefillFromEvent(pollEvent(), [opt(0, "2026-09-01", "09:00", "11:00", "odd")]);
    expect(isUnsupported(r) && r.reason).toMatch(/end time/);
  });

  it("lands every option on tomorrow or later", () => {
    const r = pollPrefillFromEvent(pollEvent(), [opt(0, "2026-09-25", "09:00", "10:00")]); // a Friday
    if (isUnsupported(r)) throw new Error(r.reason);
    const resolved = resolvePollPrefill(r.prefill, { today: TODAY, timezone: "Europe/Berlin" });
    if (isUnsupported(resolved)) throw new Error(resolved.reason);
    expect(resolved.days[0].date).toBe("2026-10-02");
  });
});

describe("privacy", () => {
  it("a copied prefill carries only public structure", () => {
    const { event, slots } = created({ mode: "single" }, "2026-10-17", [shift(1, "M", "08:00", "09:00", [["T", 1]])]);
    const leaky = { ...event, organizerName: "Ann", organizerEmail: "ann@example.com", adminToken: "secret", status: "FINALIZED", winningSlotId: "s000" } as SourceEvent;
    const p = copy(leaky, slots);
    expect(Object.keys(p).sort()).toEqual(["anchor", "dates", "details", "shifts", "source"]);
    expect(Object.keys(p.details).sort()).toEqual(["description", "location", "timezone", "title"]);
    expect(JSON.stringify(p)).not.toMatch(/ann@example|secret|FINALIZED|s000/);
  });

  it("a copied poll carries only public structure", () => {
    const r = pollPrefillFromEvent(
      { id: "p", type: "TIME_POLL", title: "T", description: "", location: "", eventDate: "2026-09-01", timezone: "UTC", durationMinutes: 30, settings: "{}", organizerEmail: "x@y.z", winningSlotId: "o0" } as SourceEvent,
      [{ id: "o0", title: "x", shiftName: null, capacity: 999, slotDate: "2026-09-01", startTime: "09:00", endTime: "09:30", displayOrder: 0 }]
    );
    if (isUnsupported(r)) throw new Error(r.reason);
    expect(Object.keys(r.prefill).sort()).toEqual(["anchor", "details", "durationMinutes", "notes", "options", "source"]);
    expect(JSON.stringify(r.prefill)).not.toMatch(/x@y\.z|o0/);
  });
});

describe("poll prefill resolution", () => {
  const base: PollPrefill = {
    source: { kind: "template", slug: "t", name: "T" },
    details: { title: "Pickup soccer", description: "", location: "", timezone: null },
    anchor: { kind: "offset", offsetDays: 1 },
    durationMinutes: 90,
    options: [
      { dayOffset: 0, startTime: "18:00", label: "" },
      { dayOffset: 1, startTime: "18:00", label: "" },
    ],
    notes: [],
  };

  it("refuses more than 31 options instead of truncating", () => {
    const many = { ...base, options: Array.from({ length: 32 }, (_, i) => ({ dayOffset: i, startTime: "18:00", label: "" })) };
    const r = resolvePollPrefill(many, { today: TODAY, timezone: "UTC" });
    expect(isUnsupported(r)).toBe(true);
  });

  it("uses deterministic ids", () => {
    const r = resolvePollPrefill(base, { today: TODAY, timezone: "UTC" });
    if (isUnsupported(r)) throw new Error(r.reason);
    expect(r.days.map((d) => d.id)).toEqual([1, 2]);
  });
});
