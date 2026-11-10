import { describe, expect, it } from "vitest";
import { buildAdminCookie, getPresentedAdminToken } from "~/utils/auth";

const request = (cookie: string, query = "") =>
  new Request(`https://example.com/events/evt1${query}`, { headers: { cookie } });

describe("getPresentedAdminToken", () => {
  it("reads the event's own admin cookie", () => {
    const cookie = buildAdminCookie("evt1", "tok en").split(";")[0];
    expect(getPresentedAdminToken(request(`other=1; ${cookie}`), "evt1")).toBe("tok en");
  });

  it("ignores a malformed value in an unrelated cookie instead of throwing", () => {
    expect(getPresentedAdminToken(request("theme=100%; mm_admin_evt1=abc"), "evt1")).toBe("abc");
  });

  it("falls back to ?admin= when its own cookie is damaged", () => {
    expect(getPresentedAdminToken(request("mm_admin_evt1=%E0%A4%A", "?admin=fromlink"), "evt1")).toBe("fromlink");
  });

  it("never returns another event's cookie", () => {
    expect(getPresentedAdminToken(request("mm_admin_evt2=abc"), "evt1")).toBeNull();
  });
});
