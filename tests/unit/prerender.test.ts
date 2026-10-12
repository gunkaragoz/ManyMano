import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DOCUMENT_SECURITY_HEADERS, setDocumentSecurityHeaders } from "~/utils/document-headers";
import { servePrerenderedPage } from "~/utils/prerender";

const req = (path: string, init?: RequestInit) => new Request("https://example.com" + path, init);

describe("prerendered public pages", () => {
  it.each(["/events/abc?admin=secret", "/create/poll", "/create/signup", "/pulse", "/signup-sheet/potluck"])(
    "leaves dynamic route %s to its server loaders", async (path) => {
      const fetch = vi.fn();
      expect(await servePrerenderedPage(req(path), { fetch })).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("leaves writes to the router even on a static path", async () => {
    const fetch = vi.fn();
    expect(await servePrerenderedPage(req("/", { method: "POST" }), { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves static HTML without forwarding query strings and preserves security and Vary", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response("<h1>Templates</h1>", { headers: { Vary: "Accept-Encoding" } }));
    const res = await servePrerenderedPage(req("/templates/?admin=secret"), { fetch });
    expect(fetch.mock.calls[0][0].url).toBe("https://example.com/templates/index.html");
    expect(await res!.text()).toBe("<h1>Templates</h1>");
    expect(res!.headers.get("Vary")).toBe("Accept-Encoding, Accept");
    for (const [key, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
      expect(res!.headers.get(key)).toBe(value);
    }
  });

  it("serves precomputed Markdown with its token count", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response("# Templates", { headers: { "x-markdown-tokens": "3" } }));
    const res = await servePrerenderedPage(req("/templates", { headers: { Accept: "text/markdown" } }), { fetch });
    expect(fetch.mock.calls[0][0].url).toBe("https://example.com/_prerender/templates.md");
    expect(res!.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res!.headers.get("x-markdown-tokens")).toBe("3");
    expect(await res!.text()).toBe("# Templates");
  });

  it("keeps HEAD as HTML, matching existing Markdown negotiation", async () => {
    const fetch = vi.fn(async (_request: Request) => new Response(null));
    const res = await servePrerenderedPage(req("/", { method: "HEAD", headers: { Accept: "text/markdown" } }), { fetch });
    const assetRequest = fetch.mock.calls[0][0];
    expect(assetRequest.method).toBe("HEAD");
    expect(assetRequest.url).toBe("https://example.com/index.html");
    expect(res!.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res!.text()).toBe("");
  });

  it("falls back to SSR before the build has generated the static files", async () => {
    expect(await servePrerenderedPage(req("/"), {
      fetch: vi.fn(async () => new Response(null, { status: 404 })),
    })).toBeNull();
  });

  it("preserves conditional asset responses", async () => {
    const res = await servePrerenderedPage(req("/"), {
      fetch: vi.fn(async () => new Response(null, { status: 304 })),
    });
    expect(res!.status).toBe(304);
    expect(await res!.text()).toBe("");
  });

  it("keeps custom route security headers", () => {
    const headers = new Headers({ "Referrer-Policy": "same-origin" });
    setDocumentSecurityHeaders(headers);
    expect(headers.get("Referrer-Policy")).toBe("same-origin");
  });

  it("keeps direct static-asset security headers aligned with SSR", () => {
    const source = readFileSync("public/_headers", "utf8");
    const globalHeaders = source.split("\n/*\n")[1].split("\n/events/")[0];
    for (const [key, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
      expect(globalHeaders).toContain("  " + key + ": " + value);
    }
  });
});
