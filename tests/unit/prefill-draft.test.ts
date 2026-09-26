// @vitest-environment jsdom
//
// Draft lifecycle of the create pages with a template or copy: the real route
// components, a stub router, sessionStorage, and the real prefill loader (with
// a fake DB for copies). Pure resolver tests can't catch effect-ordering bugs
// like a restored draft or timezone detection overwriting a prefill.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, createElement, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub, useLoaderData, useLocation, useNavigate } from "react-router";
import { events } from "~/db";
import { writeDateSpec } from "~/utils/recurrence";
import { loadCreatePrefill } from "~/utils/prefill.server";
import { usePersistentState } from "~/utils/usePersistentState";
import { usePrefill } from "~/utils/usePrefill";
import type { PrefillLoad, PrefillSource } from "~/utils/prefill";

// The browser's zone, fixed so "auto-detect overwrote a copied UTC" is visible.
vi.mock("~/utils/timezones", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/timezones")>()),
  detectLocalTimezone: () => "America/New_York",
}));

const SignupRoute = await import("~/routes/create.signup");
const PollRoute = await import("~/routes/create.poll");

const SIGNUP_DETAILS_KEY = "manymano:create-signup:details:v2";
const SIGNUP_SHIFTS_KEY = "manymano:create-signup:shifts:v1";
const POLL_DETAILS_KEY = "manymano:create-poll:details:v2";

function fakeDb(eventRow: Record<string, unknown> | null, slotRows: Array<Record<string, unknown>>) {
  return {
    select: () => ({
      from: (table: unknown) => {
        const rows = table === events ? (eventRow ? [eventRow] : []) : slotRows;
        const query = { where: () => query, limit: async () => rows, then: (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok) };
        return query;
      },
    }),
  };
}

let db: ReturnType<typeof fakeDb> = fakeDb(null, []);
let actionResult: unknown = { error: "Please enter your name." };

function LocationProbe() {
  const location = useLocation();
  return createElement("output", { "data-testid": "location" }, `${location.pathname}${location.search}`);
}

function stubFor(flow: "signup" | "poll") {
  const Route = flow === "signup" ? SignupRoute : PollRoute;
  return createRoutesStub([
    {
      path: `/create/${flow}`,
      Component: () => createElement("div", null, createElement(Route.default), createElement(LocationProbe)),
      loader: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const prefill = await loadCreatePrefill(flow, url, { db: () => db, retentionDays: 365 });
        if ("redirect" in prefill) throw new Error("unexpected redirect");
        return { turnstileSiteKey: null, prefill, isCopy: url.searchParams.has("from") };
      },
      action: async () => actionResult,
    },
    { path: "/templates", Component: () => createElement("p", null, "templates hub") },
  ]);
}

function renderAt(flow: "signup" | "poll", entry: string, strict = false) {
  const Stub = stubFor(flow);
  const tree = createElement(Stub, { initialEntries: [entry] });
  return render(strict ? createElement(StrictMode, null, tree) : tree);
}

const byName = (name: string) => document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;

const OLD_DRAFT = {
  title: "Old draft",
  eventDate: "2026-12-01",
  description: "old",
  location: "old place",
  organizerName: "Sam Organizer",
  organizerEmail: "sam@example.com",
  timezone: "Europe/Berlin",
};

beforeEach(() => {
  window.sessionStorage.clear();
  db = fakeDb(null, []);
  actionResult = { error: "Please enter your name." };
  // jsdom lacks these; the create pages use them for the sticky header.
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("sign-up create page with a template", () => {
  it("replaces an old draft across every field, blanks the organizer, and strips the parameter", async () => {
    window.sessionStorage.setItem(SIGNUP_DETAILS_KEY, JSON.stringify(OLD_DRAFT));
    window.sessionStorage.setItem(SIGNUP_SHIFTS_KEY, JSON.stringify([{ id: 9, name: "Old", startTime: "", endTime: "", tasks: [{ id: 91, title: "Old task", capacity: 1 }] }]));
    renderAt("signup", "/create/signup?template=potluck");

    await waitFor(() => expect(byName("title").value).toBe("Potluck Dinner"));
    expect(byName("organizerName").value).toBe("");
    expect(byName("organizerEmail").value).toBe("");
    expect(byName("location").value).toBe("[Venue or address]");
    const tasks = [...document.querySelectorAll<HTMLInputElement>('[name="slotTitle"]')].map((i) => i.value);
    expect(tasks).toContain("Main dish");
    expect(tasks).not.toContain("Old task");
    expect(screen.getByText(/Started from the Potluck template/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/create/signup"));
    // The replacement is the new draft.
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SIGNUP_DETAILS_KEY)!).title).toBe("Potluck Dinner"));
  });

  it("keeps later edits across a refresh and never re-applies the template", async () => {
    const first = renderAt("signup", "/create/signup?template=potluck");
    await waitFor(() => expect(byName("title").value).toBe("Potluck Dinner"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/create/signup"));
    fireEvent.change(byName("title"), { target: { value: "Our potluck" } });
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SIGNUP_DETAILS_KEY)!).title).toBe("Our potluck"));
    first.unmount();

    // A refresh lands on the stripped URL.
    renderAt("signup", "/create/signup");
    await waitFor(() => expect(byName("title").value).toBe("Our potluck"));
  });

  it("keeps edits after a failed submit (no re-apply on revalidation)", async () => {
    renderAt("signup", "/create/signup?template=potluck");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/create/signup"));
    fireEvent.change(byName("title"), { target: { value: "Edited" } });
    fireEvent.change(byName("organizerName"), { target: { value: "Pat" } });
    fireEvent.change(byName("organizerEmail"), { target: { value: "pat@example.com" } });
    const form = document.querySelector("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });
    await waitFor(() => expect(screen.getAllByText("Please enter your name.").length).toBeGreaterThan(0));
    expect(byName("title").value).toBe("Edited");
  });

  it("uses today on the event's calendar, not UTC", async () => {
    // 02:00 UTC Saturday = 22:00 Friday in New York: the next Saturday
    // strictly after "today" is tomorrow-in-UTC, not a week later.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T02:00:00Z"));
    renderAt("signup", "/create/signup?template=potluck");
    await waitFor(() => expect(byName("title").value).toBe("Potluck Dinner"));
    expect(byName("eventDate").value).toBe("2026-09-26");
    expect(byName("timezone").value).toBe("America/New_York");
  });

  it("Start blank resets to an empty draft and hides the banner; dismiss changes nothing", async () => {
    renderAt("signup", "/create/signup?template=potluck");
    await waitFor(() => expect(byName("title").value).toBe("Potluck Dinner"));
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByText(/Started from the Potluck template/)).toBeNull();
    expect(byName("title").value).toBe("Potluck Dinner");
    cleanup();

    window.sessionStorage.clear();
    renderAt("signup", "/create/signup?template=potluck");
    await waitFor(() => expect(byName("title").value).toBe("Potluck Dinner"));
    fireEvent.click(screen.getByText("Start blank"));
    await waitFor(() => expect(byName("title").value).toBe(""));
    expect(screen.queryByText(/Started from the Potluck template/)).toBeNull();
    expect(byName("timezone").value).toBe("America/New_York");
  });

  it("leaves the draft alone when the template doesn't exist", async () => {
    window.sessionStorage.setItem(SIGNUP_DETAILS_KEY, JSON.stringify(OLD_DRAFT));
    renderAt("signup", "/create/signup?template=nope");
    await waitFor(() => expect(screen.getByText(/That template doesn't exist anymore/)).toBeTruthy());
    expect(byName("title").value).toBe("Old draft");
    expect(byName("organizerName").value).toBe("Sam Organizer");
  });

  it("still works when sessionStorage is unavailable", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderAt("signup", "/create/signup?template=potluck");
    await waitFor(() => expect(byName("title").value).toBe("Potluck Dinner"));
    get.mockRestore();
    set.mockRestore();
  });
});

describe("copies on the create pages", () => {
  const sheet = {
    id: "Sheet12345", type: "SIGNUP_SHEET", title: "Robotics club", description: "", location: "Lab",
    eventDate: "2026-10-06", timezone: "UTC", durationMinutes: null,
    settings: writeDateSpec(null, { mode: "single" }), createdAt: new Date().toISOString(),
  };
  const sheetSlots = [{ id: "a", title: "Mentor", shiftName: "Session", capacity: 2, slotDate: null, startTime: "16:00", endTime: "17:00", displayOrder: 0 }];

  it("a copied UTC timezone survives the browser-timezone auto-detect", async () => {
    db = fakeDb(sheet, sheetSlots);
    renderAt("signup", "/create/signup?from=Sheet12345");
    await waitFor(() => expect(byName("title").value).toBe("Robotics club"));
    expect(byName("timezone").value).toBe("UTC");
    expect(screen.getByText(/Copied from “Robotics club”/)).toBeTruthy();
    expect(screen.getByText(/No sign-ups were copied/)).toBeTruthy();
  });

  it("an unsupported copy keeps the draft and explains why", async () => {
    window.sessionStorage.setItem(SIGNUP_DETAILS_KEY, JSON.stringify(OLD_DRAFT));
    db = fakeDb(
      { ...sheet, settings: writeDateSpec(null, { mode: "range", end: "2026-10-07" }) },
      [
        { ...sheetSlots[0], slotDate: "2026-10-06" },
        { ...sheetSlots[0], id: "b", slotDate: "2026-10-07", capacity: 5 },
      ]
    );
    renderAt("signup", "/create/signup?from=Sheet12345");
    await waitFor(() => expect(screen.getByText(/can't copy yet/)).toBeTruthy());
    expect(screen.getByText("Back to the event").closest("a")!.getAttribute("href")).toBe("/events/Sheet12345");
    expect(byName("title").value).toBe("Old draft");
  });

  it("an all-day poll is copied as 1 hour, with the note", async () => {
    window.sessionStorage.setItem(POLL_DETAILS_KEY, JSON.stringify({ ...OLD_DRAFT, eventDate: undefined }));
    db = fakeDb(
      { id: "Poll123456", type: "TIME_POLL", title: "Family picnic", description: "", location: "", eventDate: "2026-09-05", timezone: "Europe/Berlin", durationMinutes: null, settings: "{}", createdAt: new Date().toISOString() },
      [
        { id: "o1", title: "Sat, Sep 5 · All day", shiftName: null, capacity: 999, slotDate: "2026-09-05", startTime: null, endTime: null, displayOrder: 0 },
        { id: "o2", title: "Sunday option", shiftName: null, capacity: 999, slotDate: "2026-09-06", startTime: null, endTime: null, displayOrder: 1 },
      ]
    );
    renderAt("poll", "/create/poll?from=Poll123456");
    await waitFor(() => expect(byName("title").value).toBe("Family picnic"));
    expect(screen.getByText(/The original poll was all day; this copy uses 1 hour/)).toBeTruthy();
    expect(screen.getByText(/No votes were copied/)).toBeTruthy();
    expect(byName("durationMinutes").value).toBe("60");
    expect(byName("organizerName").value).toBe("");
    expect(byName("timezone").value).toBe("Europe/Berlin");
    const labels = [...document.querySelectorAll<HTMLInputElement>('[name="slotTitle"]')].map((i) => i.value);
    expect(labels).toEqual(["", "Sunday option"]);
    const starts = [...document.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="slotStartTime"]')].map((i) => i.value);
    expect(starts).toEqual(["10:00", "10:00"]);
  });
});

// The hook on its own: counts applications, which the pages can't expose.
describe("usePrefill", () => {
  const source: PrefillSource = { kind: "template", slug: "a", name: "A" };
  let applied: string[] = [];

  function Harness() {
    const { prefill } = useLoaderData() as { prefill: PrefillLoad<{ source: PrefillSource; title: string }> };
    const [value, setValue, , restored] = usePersistentState("test:harness", "start");
    const navigate = useNavigate();
    const [, force] = useState(0);
    const { pending, notice } = usePrefill({
      load: prefill,
      restored,
      apply: (p) => {
        applied.push(p.title);
        setValue(p.title);
        return { notes: [] };
      },
    });
    return createElement(
      "div",
      null,
      createElement("output", { "data-testid": "value" }, value),
      createElement("output", { "data-testid": "pending" }, String(pending)),
      createElement("output", { "data-testid": "notice" }, notice?.kind ?? ""),
      createElement("button", { onClick: () => navigate("/h?template=b") }, "open b"),
      createElement("button", { onClick: () => navigate("/h?template=a") }, "open a"),
      createElement("button", { onClick: () => force((n) => n + 1) }, "rerender"),
      createElement(LocationProbe)
    );
  }

  const Stub = createRoutesStub([
    {
      path: "/h",
      Component: Harness,
      loader: ({ request }: { request: Request }) => {
        const t = new URL(request.url).searchParams.get("template");
        return { prefill: t ? { status: "ready", prefill: { source, title: t } } : { status: "none" } };
      },
    },
  ]);

  beforeEach(() => {
    applied = [];
  });

  it("applies once under Strict Mode and re-renders, then again for a new navigation", async () => {
    render(createElement(StrictMode, null, createElement(Stub, { initialEntries: ["/h?template=a"] })));
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("a"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/h"));
    fireEvent.click(screen.getByText("rerender"));
    expect(applied).toEqual(["a"]);
    expect(screen.getByTestId("pending").textContent).toBe("false");

    fireEvent.click(screen.getByText("open b"));
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("b"));
    // The same template again is a new navigation too.
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/h"));
    fireEvent.click(screen.getByText("open a"));
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("a"));
    expect(applied).toEqual(["a", "b", "a"]);
  });

  it("waits for the draft to be restored before applying", async () => {
    window.sessionStorage.setItem("test:harness", JSON.stringify("saved draft"));
    render(createElement(Stub, { initialEntries: ["/h?template=a"] }));
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("a"));
    // Had it applied before the restore, the saved draft would have won.
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem("test:harness")!)).toBe("a"));
  });
});
