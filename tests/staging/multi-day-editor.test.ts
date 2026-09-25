// Multi-day / repeating sheet write paths: create, the event editor's date
// changes, and the shift cards — the cases the unit tests can't reach because
// they live in route actions against D1.
//
// Runs ONLY when STAGING_URL is set (otherwise skipped, so local `vitest run`
// never touches the network). Local run against `pnpm run dev`:
//   STAGING_URL=http://localhost:5190 pnpm run test:staging
// Same guard as write-paths: refuses anything that isn't staging/preview/local.
// Every sheet it creates is deleted at the end, and organizer emails go to
// non-deliverable `stg-smoke-*@example.com` addresses.
//
// Rows are read back through the event loader (`/events/:id.data`, decoded
// with React Router's turbo-stream decoder) using the organizer cookie the
// create redirect sets — so the assertions see exactly what the page sees.
import { afterAll, describe, expect, it } from "vitest";
import { UNSAFE_decodeViaTurboStream as decodeTurboStream } from "react-router";

const STAGING_URL = (process.env.STAGING_URL ?? "").replace(/\/$/, "");
const LIVE = Boolean(STAGING_URL);
const STAMP = Date.now().toString(36);

type Sheet = { id: string; admin: string; cookie: string };
type Slot = {
  id: string;
  slotDate: string | null;
  shiftName: string | null;
  title: string;
  capacity: number;
  startTime: string | null;
  endTime: string | null;
};

const created: Sheet[] = [];

function assertStaging(url: string) {
  const host = new URL(url).hostname;
  const ok =
    host.includes("stg") ||
    host.includes("staging") ||
    host.includes("preview") ||
    host === "localhost" ||
    host === "127.0.0.1";
  expect(ok, `REFUSING multi-day write tests against non-staging host ${host}`).toBe(true);
}

function body(fields: Record<string, string | number | Array<string | number> | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, String(v));
  }
  return params.toString();
}

const HEADERS = () => ({ Origin: STAGING_URL, "Content-Type": "application/x-www-form-urlencoded" });
const ORGANIZER = {
  organizerName: "Staging Smoke",
  organizerEmail: `stg-smoke-${STAMP}@example.com`,
  timezone: "America/New_York",
};

/** Creates a sheet; returns it, or the error message when create refuses. */
async function create(
  fields: Record<string, string | number | Array<string | number> | undefined>
): Promise<Sheet | { error: string }> {
  const res = await fetch(`${STAGING_URL}/create/signup`, {
    method: "POST",
    redirect: "manual",
    headers: HEADERS(),
    body: body({ ...ORGANIZER, ...fields, title: `stg-multiday-${STAMP} ${fields.title ?? ""}` }),
  });
  const match = (res.headers.get("location") ?? "").match(/\/events\/([^?]+)\?admin=([^&]+)/);
  if (!match) {
    const text = await res.text();
    return { error: text.match(/"error","([^"]*)"/)?.[1] ?? `HTTP ${res.status}` };
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const sheet = { id: match[1], admin: match[2], cookie };
  created.push(sheet);
  return sheet;
}

async function mustCreate(fields: Parameters<typeof create>[0]): Promise<Sheet> {
  const result = await create(fields);
  if ("error" in result) throw new Error(`create failed: ${result.error}`);
  return result;
}

/** Posts an organizer action; `ok` is true only for a success payload. */
async function act(sheet: Sheet, fields: Parameters<typeof body>[0]) {
  const res = await fetch(`${STAGING_URL}/events/${sheet.id}.data`, {
    method: "POST",
    redirect: "manual",
    headers: HEADERS(),
    body: body({ adminToken: sheet.admin, ...fields }),
  });
  const text = await res.text();
  return {
    status: res.status,
    ok: res.status < 300 && /"success",true/.test(text),
    message: text.match(/"(?:error|message)","([^"]*)"/)?.[1] ?? "",
  };
}

/** The sheet's slots as the event page loads them, ordered by day then position. */
async function slots(sheet: Sheet): Promise<Slot[]> {
  const res = await fetch(`${STAGING_URL}/events/${sheet.id}.data`, { headers: { cookie: sheet.cookie } });
  expect(res.status).toBe(200);
  const decoded = await decodeTurboStream(res.body!, globalThis);
  await decoded.done;
  const route = (decoded.value as Record<string, { data: { slots: Slot[] } }>)["routes/events.$id"];
  return route.data.slots;
}

const days = async (sheet: Sheet) => [...new Set((await slots(sheet)).map((s) => s.slotDate))].sort();

/** The editor's details form, with the date fields the RepeatPicker posts. */
const editDetails = (fields: Parameters<typeof body>[0]) => ({
  intent: "update_event",
  title: `stg-multiday-${STAMP} edited`,
  organizerName: ORGANIZER.organizerName,
  timezone: ORGANIZER.timezone,
  ...fields,
});

const weekly = (weekdays: string, count: number) => ({
  dateMode: "repeat",
  repeatType: "weekly",
  repeatInterval: 1,
  repeatWeekdays: weekdays,
  repeatEndMode: "after",
  repeatCount: count,
});

afterAll(async () => {
  for (const sheet of created) {
    await fetch(`${STAGING_URL}/events/${sheet.id}.data`, {
      method: "POST",
      redirect: "manual",
      headers: HEADERS(),
      body: body({ intent: "delete_event", adminToken: sheet.admin }),
    });
  }
});

describe.skipIf(!LIVE)("multi-day sheets: create", () => {
  it("expands a weekly rule into one row per (date x task), honouring shift days", async () => {
    assertStaging(STAGING_URL);
    // Mon + Wed from Wed 2026-10-07, four times; "Evening" runs on Mondays only.
    const sheet = await mustCreate({
      eventDate: "2026-10-07",
      ...weekly("1,3", 4),
      slotTitle: ["Setup", "Cleanup"],
      slotCapacity: [2, 3],
      slotShiftName: ["Morning", "Evening"],
      slotStartTime: ["09:00", "18:00"],
      slotEndTime: ["11:00", "20:00"],
      slotDays: ["all", "w1"],
    });
    const rows = await slots(sheet);
    expect([...new Set(rows.map((r) => r.slotDate))].sort()).toEqual([
      "2026-10-07",
      "2026-10-12",
      "2026-10-14",
      "2026-10-19",
    ]);
    expect(rows.filter((r) => r.shiftName === "Evening").map((r) => r.slotDate)).toEqual([
      "2026-10-12",
      "2026-10-19",
    ]);
  });

  it("refuses a rule that produces no dates", async () => {
    // Every weekday, Saturday to Sunday.
    const result = await create({
      eventDate: "2026-11-21",
      dateMode: "repeat",
      repeatType: "weekdays",
      repeatEndMode: "on",
      repeatEndDate: "2026-11-22",
      slotTitle: ["Desk"],
      slotCapacity: [1],
    });
    expect(result).toHaveProperty("error");
  });

  it("refuses same-named tasks in one shift with different days", async () => {
    const result = await create({
      eventDate: "2026-11-16",
      ...weekly("1,3,5", 3),
      slotTitle: ["Greeter", "Greeter"],
      slotCapacity: [1, 2],
      slotShiftName: ["AM", "AM"],
      slotStartTime: ["09:00", "09:00"],
      slotEndTime: ["10:00", "10:00"],
      slotDays: ["w1,w3", "w3,w5"],
    });
    expect(result).toHaveProperty("error");
  });
});

describe.skipIf(!LIVE)("multi-day sheets: editing the dates", () => {
  it("new days copy the nearest day on the same weekday", async () => {
    assertStaging(STAGING_URL);
    const sheet = await mustCreate({
      eventDate: "2026-10-07",
      ...weekly("1,3", 4),
      slotTitle: ["Setup", "Cleanup"],
      slotCapacity: [2, 3],
      slotShiftName: ["Morning", "Evening"],
      slotStartTime: ["09:00", "18:00"],
      slotEndTime: ["11:00", "20:00"],
      slotDays: ["all", "w1"],
    });
    const r = await act(sheet, editDetails({ eventDate: "2026-10-07", ...weekly("1,3", 6) }));
    expect(r.ok, r.message).toBe(true);
    const rows = await slots(sheet);
    // Monday Oct 26 gets Evening; Wednesday Oct 21 does not.
    expect(rows.filter((x) => x.shiftName === "Evening").map((x) => x.slotDate)).toEqual([
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
    ]);
    expect(rows.filter((x) => x.slotDate === "2026-10-21").map((x) => x.title)).toEqual(["Setup"]);
  });

  it("refuses to drop a day someone signed up for", async () => {
    const sheet = await mustCreate({ eventDate: "2026-11-16", dateMode: "range", dateEnd: "2026-11-18", slotTitle: ["Desk"], slotCapacity: [1] });
    const lastDay = (await slots(sheet)).find((s) => s.slotDate === "2026-11-18")!;
    const signup = await act({ ...sheet, admin: "" }, {
      intent: "signup",
      slotId: lastDay.id,
      participantName: "Smoke Volunteer",
    });
    expect(signup.ok, signup.message).toBe(true);
    const r = await act(sheet, editDetails({ eventDate: "2026-11-16", dateMode: "range", dateEnd: "2026-11-17" }));
    expect(r.status).toBe(400);
    expect(await days(sheet)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
  });

  it("keeps a deliberately empty day empty when only the title changes", async () => {
    const sheet = await mustCreate({
      eventDate: "2026-11-16",
      dateMode: "range",
      dateEnd: "2026-11-18",
      slotTitle: ["Desk"],
      slotCapacity: [1],
      slotShiftName: ["AM"],
      slotStartTime: ["09:00"],
      slotEndTime: ["10:00"],
      slotDays: ["2026-11-16,2026-11-18"],
    });
    const r = await act(sheet, editDetails({ eventDate: "2026-11-16", dateMode: "range", dateEnd: "2026-11-18" }));
    expect(r.ok, r.message).toBe(true);
    expect(await days(sheet)).toEqual(["2026-11-16", "2026-11-18"]);
  });

  it("refuses an edit that would leave no tasks", async () => {
    const sheet = await mustCreate({
      eventDate: "2026-11-16",
      dateMode: "range",
      dateEnd: "2026-11-18",
      slotTitle: ["Desk"],
      slotCapacity: [1],
      slotShiftName: ["AM"],
      slotStartTime: ["09:00"],
      slotEndTime: ["10:00"],
      slotDays: ["2026-11-16,2026-11-18"],
    });
    // Narrow to Tuesday, the one day the shift skips.
    const r = await act(sheet, editDetails({ eventDate: "2026-11-17", dateMode: "range", dateEnd: "2026-11-17" }));
    expect(r.status).toBe(400);
    expect(await slots(sheet)).toHaveLength(2);
  });

  it("refuses a rule that produces no dates, and deletes nothing", async () => {
    const sheet = await mustCreate({ eventDate: "2026-11-21", dateMode: "range", dateEnd: "2026-11-22", slotTitle: ["Desk"], slotCapacity: [1] });
    const r = await act(
      sheet,
      editDetails({ eventDate: "2026-11-21", dateMode: "repeat", repeatType: "weekdays", repeatEndMode: "on", repeatEndDate: "2026-11-22" })
    );
    expect(r.status).toBe(400);
    expect(await slots(sheet)).toHaveLength(2);
  });

  it("turns a one-day sheet with no date into a multi-day one with tasks on every day", async () => {
    const sheet = await mustCreate({ slotTitle: ["Desk"], slotCapacity: [1] });
    const r = await act(sheet, editDetails({ eventDate: "2026-12-01", dateMode: "range", dateEnd: "2026-12-03" }));
    expect(r.ok, r.message).toBe(true);
    expect(await days(sheet)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
  });
});

describe.skipIf(!LIVE)("multi-day sheets: shift cards", () => {
  const AM = "AM||09:00||10:00";
  const sameNamed = () =>
    mustCreate({
      eventDate: "2026-11-16",
      dateMode: "range",
      dateEnd: "2026-11-17",
      slotTitle: ["Greeter", "Greeter", "Setup"],
      slotCapacity: [1, 5, 2],
      slotShiftName: ["AM", "AM", "AM"],
      slotStartTime: ["09:00", "09:00", "09:00"],
      slotEndTime: ["10:00", "10:00", "10:00"],
    });

  it("a rejected card writes nothing", async () => {
    assertStaging(STAGING_URL);
    const sheet = await sameNamed();
    // New time, plus a new task that clashes with an existing one.
    const r = await act(sheet, {
      intent: "update_shift",
      shiftKey: AM,
      slotShiftName: "AM",
      slotStartTime: "08:00",
      slotEndTime: "10:00",
      taskTitle: ["Greeter", "Greeter", "Setup", "Setup"],
      taskOriginal: ["0:Greeter", "1:Greeter", "0:Setup", ""],
      taskCapacity: [1, 5, 2, 1],
    });
    expect(r.status).toBe(400);
    expect((await slots(sheet)).every((s) => s.startTime === "09:00")).toBe(true);
  });

  it("same-named tasks keep their own capacities, and remove one at a time", async () => {
    const sheet = await sameNamed();
    let r = await act(sheet, {
      intent: "update_shift",
      shiftKey: AM,
      slotShiftName: "AM",
      slotStartTime: "09:00",
      slotEndTime: "10:00",
      taskTitle: ["Greeter", "Greeter", "Setup"],
      taskOriginal: ["0:Greeter", "1:Greeter", "0:Setup"],
      taskCapacity: [2, 7, 2],
    });
    expect(r.ok, r.message).toBe(true);
    const greeters = () => slots(sheet).then((rows) => rows.filter((s) => s.title === "Greeter").map((s) => s.capacity).sort((a, b) => a - b));
    expect(await greeters()).toEqual([2, 2, 7, 7]);

    r = await act(sheet, { intent: "delete_shift_task", shiftKey: AM, slotTitle: "Greeter", slotTask: "1:Greeter" });
    expect(r.ok, r.message).toBe(true);
    expect(await greeters()).toEqual([2, 2]);
  });

  it("add_shift, add a task, rename, remove — each across every day", async () => {
    const sheet = await mustCreate({ eventDate: "2026-11-16", dateMode: "range", dateEnd: "2026-11-18", slotTitle: ["Desk"], slotCapacity: [1] });
    let r = await act(sheet, { intent: "add_shift", slotShiftName: "PM", slotStartTime: "13:00", slotEndTime: "14:00", slotTitle: "Lead", slotCapacity: 1 });
    expect(r.ok, r.message).toBe(true);
    expect((await slots(sheet)).filter((s) => s.shiftName === "PM")).toHaveLength(3);

    r = await act(sheet, { intent: "add_shift_task", slotShiftName: "PM", slotStartTime: "13:00", slotEndTime: "14:00", slotTitle: "Runner", slotCapacity: 2 });
    expect(r.ok, r.message).toBe(true);
    expect((await slots(sheet)).filter((s) => s.title === "Runner")).toHaveLength(3);

    r = await act(sheet, {
      intent: "update_shift",
      shiftKey: "PM||13:00||14:00",
      slotShiftName: "Afternoon",
      slotStartTime: "13:00",
      slotEndTime: "15:00",
      taskTitle: ["Lead", "Runner"],
      taskOriginal: ["0:Lead", "0:Runner"],
      taskCapacity: [4, 2],
    });
    expect(r.ok, r.message).toBe(true);
    const afternoon = (await slots(sheet)).filter((s) => s.shiftName === "Afternoon");
    expect(afternoon).toHaveLength(6);
    expect(afternoon.every((s) => s.endTime === "15:00")).toBe(true);
    expect(afternoon.filter((s) => s.title === "Lead").every((s) => s.capacity === 4)).toBe(true);

    r = await act(sheet, { intent: "delete_shift", shiftKey: "Afternoon||13:00||15:00" });
    expect(r.ok, r.message).toBe(true);
    expect((await slots(sheet)).map((s) => s.title)).toEqual(["Desk", "Desk", "Desk"]);
  });

  it("won't merge one shift into another", async () => {
    const sheet = await mustCreate({
      eventDate: "2026-11-16",
      dateMode: "range",
      dateEnd: "2026-11-17",
      slotTitle: ["Greeter", "Lead"],
      slotCapacity: [1, 1],
      slotShiftName: ["AM", "PM"],
      slotStartTime: ["09:00", "13:00"],
      slotEndTime: ["10:00", "14:00"],
    });
    let r = await act(sheet, { intent: "add_shift", slotShiftName: "AM", slotStartTime: "09:00", slotEndTime: "10:00", slotTitle: "Greeter", slotCapacity: 1 });
    expect(r.status).toBe(400);
    r = await act(sheet, {
      intent: "update_shift",
      shiftKey: "PM||13:00||14:00",
      slotShiftName: "AM",
      slotStartTime: "09:00",
      slotEndTime: "10:00",
      taskTitle: ["Lead"],
      taskOriginal: ["0:Lead"],
      taskCapacity: [1],
    });
    expect(r.status).toBe(400);
    expect((await slots(sheet)).filter((s) => s.shiftName === "PM")).toHaveLength(2);
  });
});
