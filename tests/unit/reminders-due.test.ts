import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  buildMeetingOrganizerEmail,
  buildMeetingParticipantEmail,
  buildSignupOrganizerEmail,
  buildSignupParticipantEmail,
  eventStartInstant,
  isUnderstaffed,
  LEGACY_ORGANIZER_KIND,
  LEGACY_ORGANIZER_24H_KIND,
  REMINDER_HOUR,
  REMINDER_LEAD_HOURS,
  reminderDueInstant,
  reminderInstant,
  targetReminderDate,
  type FinalizedMeetingTarget,
  type SignupSheetTarget,
} from "~/utils/reminders";
import type { SiteConfig } from "~/utils/site";

const SITE: SiteConfig = {
  siteUrl: "https://example.com",
  siteName: "ManyMano",
  siteTagline: "tag",
  siteDescription: "desc",
  fromEmail: "ManyMano <no-reply@mail.example.com>",
  securityContact: "mailto:no-reply@mail.example.com",
  icsUidDomain: "example.com",
  icsProdid: "PRODID:-//ManyMano//Open Source Scheduling//EN",
};

function sheet(slots: Array<{ capacity: number; filled: number; startTime?: string | null }>): SignupSheetTarget {
  return {
    kind: "signup_sheet",
    event: {
      id: "e1",
      title: "Park Cleanup",
      description: null,
      eventDate: "2026-01-16",
      location: null,
      organizerName: "Org",
      organizerEmail: "org@example.com",
      timezone: "America/New_York",
    },
    slots: slots.map((s, i) => ({
      id: `s${i}`,
      title: `Task ${i}`,
      shiftName: null,
      startTime: s.startTime ?? null,
      endTime: null,
      capacity: s.capacity,
      signups: Array.from({ length: s.filled }, (_, j) => ({ name: `P${j}`, email: null })),
    })),
  };
}

function meeting(): FinalizedMeetingTarget {
  return {
    kind: "finalized_meeting",
    event: {
      id: "e2",
      title: "Sprint Planning",
      description: null,
      eventDate: "2026-01-10",
      location: null,
      organizerName: "O",
      organizerEmail: "o@example.com",
      timezone: "UTC",
    },
    winningSlot: { id: "s", title: "Tue 10am", slotDate: "2026-01-20", startTime: "10:00", endTime: null },
    voters: [],
  };
}

describe("48h date-based helper (reminderInstant)", () => {
  it("fires at 9:00 AM event-local", () => {
    expect(REMINDER_HOUR).toBe(9);
    // 2026-01-16 event, 2 days before = 2026-01-14 09:00 EST (UTC-5) = 14:00Z.
    expect(reminderInstant("2026-01-16", 2, "America/New_York")?.toISOString()).toBe(
      "2026-01-14T14:00:00.000Z"
    );
  });

  it("respects DST (EDT = UTC-4 in July)", () => {
    expect(reminderInstant("2026-07-16", 1, "America/New_York")?.toISOString()).toBe(
      "2026-07-15T13:00:00.000Z"
    );
  });

  it("handles UTC and far-east zones", () => {
    expect(reminderInstant("2026-01-16", 1, "UTC")?.toISOString()).toBe("2026-01-15T09:00:00.000Z");
    // Kiritimati UTC+14: 09:00 local = previous day 19:00Z.
    expect(reminderInstant("2026-01-16", 1, "Pacific/Kiritimati")?.toISOString()).toBe(
      "2026-01-14T19:00:00.000Z"
    );
  });

  it("returns null for bad dates (caller skips)", () => {
    expect(reminderInstant(null, 1, "UTC")).toBeNull();
    expect(reminderInstant("not-a-date", 1, "UTC")).toBeNull();
    expect(reminderInstant("2026-13-40", 1, "UTC")).toBeNull();
  });

  it("adds calendar days across month boundaries", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2026-01-01", 2)).toBe("2026-01-03");
    expect(addDaysIso("junk", 1)).toBeNull();
  });
});

describe("event start instant", () => {
  it("uses the earliest slot start (parsed, not lexicographic)", () => {
    const t = sheet([
      { capacity: 2, filled: 0, startTime: "19:15" },
      { capacity: 2, filled: 0, startTime: "9:00" },
      { capacity: 2, filled: 0, startTime: "21:00" },
    ]);
    // 2026-01-16 09:00 EST (UTC-5) = 14:00Z.
    expect(eventStartInstant(t)?.toISOString()).toBe("2026-01-16T14:00:00.000Z");
  });

  it("falls back to 9:00 AM when no slot carries a time", () => {
    expect(eventStartInstant(sheet([{ capacity: 2, filled: 0 }]))?.toISOString()).toBe(
      "2026-01-16T14:00:00.000Z"
    );
  });

  it("returns null without an event date", () => {
    const t = sheet([{ capacity: 1, filled: 0 }]);
    t.event.eventDate = null;
    expect(eventStartInstant(t)).toBeNull();
  });

  it("uses the winning slot for finalized meetings", () => {
    // 2026-01-20 10:00 UTC.
    expect(eventStartInstant(meeting())?.toISOString()).toBe("2026-01-20T10:00:00.000Z");
  });
});

describe("12h due instant", () => {
  it("fires 12 hours before the earliest slot start", () => {
    expect(REMINDER_LEAD_HOURS).toBe(12);
    const t = sheet([
      { capacity: 2, filled: 0, startTime: "19:15" },
      { capacity: 2, filled: 0, startTime: "21:00" },
    ]);
    // Start 2026-01-16 19:15 EST = 2026-01-17 00:15Z; due 12h earlier.
    expect(reminderDueInstant(t)?.toISOString()).toBe("2026-01-16T12:15:00.000Z");
  });

  it("respects DST (EDT = UTC-4 in July)", () => {
    const t = sheet([{ capacity: 2, filled: 0, startTime: "09:30" }]);
    t.event.eventDate = "2026-07-16";
    // Start 09:30 EDT = 13:30Z; due 01:30Z.
    expect(reminderDueInstant(t)?.toISOString()).toBe("2026-07-16T01:30:00.000Z");
  });

  it("falls back to 12h before 9:00 AM without slot times", () => {
    // Start 09:00 EST = 14:00Z; due 02:00Z.
    expect(reminderDueInstant(sheet([{ capacity: 2, filled: 0 }]))?.toISOString()).toBe(
      "2026-01-16T02:00:00.000Z"
    );
  });

  it("returns null when the start can't be determined", () => {
    const t = sheet([{ capacity: 1, filled: 0 }]);
    t.event.eventDate = null;
    expect(reminderDueInstant(t)).toBeNull();
  });
});

describe("isUnderstaffed", () => {
  it("true with open spots in a limited slot", () => {
    expect(isUnderstaffed(sheet([{ capacity: 2, filled: 1 }]))).toBe(true);
    expect(isUnderstaffed(sheet([{ capacity: 2, filled: 2 }, { capacity: 3, filled: 0 }]))).toBe(true);
  });

  it("false when full, unlimited-only, or slotless", () => {
    expect(isUnderstaffed(sheet([{ capacity: 2, filled: 2 }]))).toBe(false);
    expect(isUnderstaffed(sheet([{ capacity: -1, filled: 50 }]))).toBe(false);
    expect(isUnderstaffed(sheet([]))).toBe(false);
  });
});

describe("48h organizer email", () => {
  it("warns about open spots instead of the coming-up copy", () => {
    const mail = buildSignupOrganizerEmail(SITE, SITE.siteUrl, sheet([{ capacity: 2, filled: 1 }]), {
      horizon: "48h",
    });
    expect(mail.subject).toContain("2 days left");
    expect(mail.subject).toContain("Park Cleanup");
    expect(mail.html).toContain("needs more volunteers");
    expect(mail.html).not.toContain("is coming up");
  });

  it("12h default uses the coming-up copy (no tomorrow wording)", () => {
    const mail = buildSignupOrganizerEmail(SITE, SITE.siteUrl, sheet([{ capacity: 2, filled: 1 }]));
    expect(mail.subject).toContain("is coming up");
    expect(mail.subject).not.toContain("tomorrow");
    expect(mail.html).toContain("Your event is coming up");
    expect(mail.html).not.toContain("tomorrow");
  });

  it("participant + meeting copy is horizon-neutral", () => {
    const t = sheet([{ capacity: 2, filled: 1 }]);
    const tasks = [
      { label: "Task 0", whenLine: "Friday, January 16th, 2026", googleUrl: "https://g", icsUrl: "https://i" },
    ];
    const pm = buildSignupParticipantEmail(SITE, SITE.siteUrl, t, "P", tasks);
    expect(pm.subject).toContain("is coming up");
    expect(pm.html).toContain("See you soon!");
    expect(pm.html).not.toContain("tomorrow");
    const mm = buildMeetingParticipantEmail(SITE, SITE.siteUrl, meeting(), "V");
    expect(mm.subject).toContain("is coming up");
    expect(mm.html).not.toContain("tomorrow");
    const mo = buildMeetingOrganizerEmail(SITE, SITE.siteUrl, meeting());
    expect(mo.subject).toContain("is coming up");
    expect(mo.html).toContain("Your meeting is coming up");
    expect(mo.html).not.toContain("tomorrow");
  });
});

describe("dedupe keys", () => {
  it("keeps the legacy organizer kinds for cutover", () => {
    expect(LEGACY_ORGANIZER_KIND).toBe("organizer");
    expect(LEGACY_ORGANIZER_24H_KIND).toBe("organizer_24h");
  });

  it("keys meetings by winning-slot effective date", () => {
    expect(
      targetReminderDate({
        kind: "finalized_meeting",
        event: {
          id: "e2",
          title: "M",
          description: null,
          eventDate: "2026-01-10",
          location: null,
          organizerName: "O",
          organizerEmail: "o@example.com",
          timezone: "UTC",
        },
        winningSlot: { id: "s", title: "T", slotDate: "2026-01-12", startTime: null, endTime: null },
        voters: [],
      })
    ).toBe("2026-01-12");
    expect(targetReminderDate(sheet([{ capacity: 1, filled: 0 }]))).toBe("2026-01-16");
  });
});

describe("multi-day sheets", () => {
  // A later occurrence of a series: the sheet starts 2026-01-16, this
  // reminder is for its 2026-01-23 day.
  function laterOccurrence(): SignupSheetTarget {
    const t = sheet([{ capacity: 2, filled: 1 }]);
    return {
      ...t,
      reminderDate: "2026-01-23",
      slots: t.slots.map((s) => ({ ...s, slotDate: "2026-01-23", startTime: "09:00", endTime: "11:00" })),
    };
  }

  it("keys (and times) each occurrence by its own day, not the first date", () => {
    expect(targetReminderDate(laterOccurrence())).toBe("2026-01-23");
  });

  it("starts, and is due, from the occurrence's date", () => {
    // 09:00 New York (EST, UTC-5) on Jan 23 — not on the series' first date, Jan 16.
    expect(eventStartInstant(laterOccurrence())?.toISOString()).toBe("2026-01-23T14:00:00.000Z");
    expect(reminderDueInstant(laterOccurrence())?.toISOString()).toBe(
      new Date(Date.parse("2026-01-23T14:00:00.000Z") - REMINDER_LEAD_HOURS * 3600_000).toISOString()
    );
  });

  it("organizer email dates every task with the occurrence, not the first date", () => {
    const mail = buildSignupOrganizerEmail(SITE, SITE.siteUrl, laterOccurrence());
    expect(mail.html).toContain("January 23");
    expect(mail.html).not.toContain("January 16");
  });
});
