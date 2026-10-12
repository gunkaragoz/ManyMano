import { addVaryAccept, prefersMarkdown } from "./markdown";
import { setDocumentSecurityHeaders } from "./document-headers";

// Only pages with public, request-independent loaders belong here.
export const PRERENDER_PAGES = [
  { path: "/", html: "/index.html", markdown: "/_prerender/home.md", data: "/_.data" },
  { path: "/templates", html: "/templates/index.html", markdown: "/_prerender/templates.md", data: "/templates.data" },
] as const;

export async function servePrerenderedPage(
  request: Request,
  assets: Pick<Fetcher, "fetch">
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const page = PRERENDER_PAGES.find((p) =>
    url.pathname === p.path || url.pathname === p.html || (p.path !== "/" && url.pathname === `${p.path}/`)
  );
  if (!page) return null;
  if (url.pathname === page.html) {
    url.pathname = page.path;
    return Response.redirect(url.href, 301);
  }

  const markdown = request.method === "GET" && prefersMarkdown(request.headers.get("Accept"));
  const assetUrl = new URL(url);
  assetUrl.pathname = markdown ? page.markdown : page.html;
  assetUrl.search = "";
  const response = await assets.fetch(new Request(assetUrl, request));
  // During prerendering these files do not exist yet; fall back to SSR.
  if (response.status === 404) return null;
  const headers = new Headers(response.headers);
  setDocumentSecurityHeaders(headers);
  headers.set("Content-Type", markdown ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8");
  addVaryAccept(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
