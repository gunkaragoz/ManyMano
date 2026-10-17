import { describe, expect, it } from "vitest";
import { matchesSignupAttempt } from "~/utils/signup-attempt";

describe("signup confirmation attempts", () => {
  it("ignores a challenge after the modal was closed or reopened", () => {
    expect(matchesSignupAttempt("1", null, null)).toBe(false);
    expect(matchesSignupAttempt("1", 2, null)).toBe(false);
    expect(matchesSignupAttempt("1", 2, 2)).toBe(false);
  });

  it("resumes only the confirmed attempt", () => {
    expect(matchesSignupAttempt("2", 2, null)).toBe(false);
    expect(matchesSignupAttempt("2", 2, 2)).toBe(true);
  });
});
