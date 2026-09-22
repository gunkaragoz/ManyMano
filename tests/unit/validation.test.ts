import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX,
  MAX_SLOTS_PER_EVENT,
  cleanText,
  isPastIsoDate,
  isValidEmail,
  isValidIsoDate,
  isValidTime,
  normalizeTimezone,
  parseTimezoneInput,
  timeToMinutes,
} from "~/utils/validation";
import { escapeHtml } from "~/utils/sanitize";
import { generateInternalId, generatePublicId, generateSecretToken, generateShortId } from "~/utils/ids";

describe("validation", () => {
  it("accepts/rejects emails", () => {
    expect(isValidEmail("a@example.com")).toBe(true);
    expect(isValidEmail("bad")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(`a@${"x".repeat(300)}.com`)).toBe(false);
    expect("a@example.com".length <= EMAIL_MAX).toBe(true);
  });

  it("validates ISO dates strictly (rejects 2026-02-30)", () => {
    expect(isValidIsoDate("2026-10-17")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("17/10/2026")).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
  });

  it("treats before-yesterday as past", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect(isPastIsoDate(twoDaysAgo)).toBe(true);
    expect(isPastIsoDate(tomorrow)).toBe(false);
  });

  it("validates 24h times", () => {
    expect(isValidTime("08:00")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("9:00 AM")).toBe(false);
    expect(timeToMinutes("08:30")).toBe(510);
  });

  it("normalizes timezones without guessing", () => {
    expect(parseTimezoneInput("")).toBe("UTC");
    expect(parseTimezoneInput("Europe/Berlin")).toBe("Europe/Berlin");
    expect(parseTimezoneInput("Mars/Olympus")).toBeNull();
    expect(normalizeTimezone("Mars/Olympus")).toBe("UTC");
  });

  it("truncates free text", () => {
    expect(cleanText("  hi  ", 10)).toBe("hi");
    expect(cleanText("x".repeat(500), 200).length).toBe(200);
    expect(MAX_SLOTS_PER_EVENT).toBe(31);
  });
});

describe("sanitize", () => {
  it("escapes HTML", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
    expect(escapeHtml(null)).toBe("");
  });
});

describe("ids", () => {
  it("generates URL-safe ids of the right length", () => {
    expect(generatePublicId()).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(generateInternalId()).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(generateSecretToken()).toMatch(/^[0-9A-Za-z]{32}$/);
    expect(() => generateShortId(0)).toThrow();
  });

  it("generates unique values", () => {
    const set = new Set(Array.from({ length: 100 }, () => generatePublicId()));
    expect(set.size).toBeGreaterThan(95);
  });
});
