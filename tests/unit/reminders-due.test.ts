import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  buildSignupOrganizerEmail,
  isUnderstaffed,
  LEGACY_ORGANIZER_KIND,
  REMINDER_HOUR,
  reminderInstant,
  targetReminderDate,
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

function sheet(slots: Array<{ capacity: number; filled: number }>): SignupSheetTarget {
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
      startTime: null,
      endTime: null,
      capacity: s.capacity,
      signups: Array.from({ length: s.filled }, (_, j) => ({ name: `P${j}`, email: null })),
    })),
  };
}

describe("reminder hour + instants", () => {
  it("fires at 9:00 AM event-local", () => {
    expect(REMINDER_HOUR).toBe(9);
    // 2026-01-16 event, 24h before = 2026-01-15 09:00 EST (UTC-5) = 14:00Z.
    expect(reminderInstant("2026-01-16", 1, "America/New_York")?.toISOString()).toBe(
      "2026-01-15T14:00:00.000Z"
    );
    // 48h before = 2026-01-14 09:00 EST.
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
  it("warns about open spots instead of the tomorrow copy", () => {
    const mail = buildSignupOrganizerEmail(SITE, SITE.siteUrl, sheet([{ capacity: 2, filled: 1 }]), {
      horizon: "48h",
    });
    expect(mail.subject).toContain("2 days left");
    expect(mail.subject).toContain("Park Cleanup");
    expect(mail.html).toContain("needs more volunteers");
    expect(mail.html).not.toContain("is tomorrow");
  });

  it("24h default keeps the tomorrow copy", () => {
    const mail = buildSignupOrganizerEmail(SITE, SITE.siteUrl, sheet([{ capacity: 2, filled: 1 }]));
    expect(mail.subject).toContain("is tomorrow");
  });
});

describe("dedupe keys", () => {
  it("keeps the legacy organizer kind for cutover", () => {
    expect(LEGACY_ORGANIZER_KIND).toBe("organizer");
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
