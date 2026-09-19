import { describe, expect, it } from "vitest";
import { assessGuestRequest, needsVerification } from "../../app/utils/bot-protection";

function form(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("assessGuestRequest", () => {
  it("allows a plain guest write with no email", () => {
    expect(assessGuestRequest(form(), { ip: "1.1.1.1", eventId: "e1" })).toEqual({ verdict: "allow" });
  });

  it("asks for a human check when a confirmation email will be sent", () => {
    const r = assessGuestRequest(form(), { ip: "1.1.1.2", eventId: "e1", sendsEmail: true });
    expect(r).toEqual({ verdict: "challenge", reason: "email" });
    if (r.verdict === "challenge") expect(needsVerification(r).body.needsVerification).toBe(true);
  });

  it("still flags honeypot bots before the email rule", () => {
    const r = assessGuestRequest(form({ company_website: "x" }), { ip: "1.1.1.3", eventId: "e1", sendsEmail: true });
    expect(r).toEqual({ verdict: "bot" });
  });
});
