import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
// @ts-ignore
import { renderToReadableStream } from "react-dom/server.browser";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext
) {
  const body = await renderToReadableStream(
    <ServerRouter context={remixContext} url={request.url} />,
    {
      signal: request.signal,
      onError(error: unknown) {
        console.error(error);
        responseStatusCode = 500;
      },
    }
  );

  if (isbot(request.headers.get("user-agent") || "")) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  // App hardening: no referrer leaks of ?admin= / ?cancel_token=, no framing.
  if (!responseHeaders.has("Referrer-Policy")) {
    responseHeaders.set("Referrer-Policy", "no-referrer");
  }
  if (!responseHeaders.has("X-Content-Type-Options")) {
    responseHeaders.set("X-Content-Type-Options", "nosniff");
  }
  if (!responseHeaders.has("X-Frame-Options")) {
    responseHeaders.set("X-Frame-Options", "DENY");
  }
  if (!responseHeaders.has("Permissions-Policy")) {
    responseHeaders.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  }
  // CSP: lock down resource origins. React Router renders its hydration
  // runtime (ScrollRestoration, route modules, context payload) as inline
  // <script> with no nonce support — and per-request payloads rule out
  // hashes — so script-src keeps 'unsafe-inline'. The app itself ships no inline
  // scripts/handlers; React escaping remains the XSS backstop. Turnstile
  // CDN added for widget script + challenge iframe.
  // frame-ancestors mirrors X-Frame-Options for CSP-aware browsers.
  if (!responseHeaders.has("Content-Security-Policy")) {
    responseHeaders.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' https://challenges.cloudflare.com",
        "frame-src https://challenges.cloudflare.com",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
      ].join("; ")
    );
  }
  // HSTS: production HTTPS only. Browsers ignore it on http://localhost,
  // and Cloudflare already sends HSTS on proxied zones — harmless to repeat.
  if (!responseHeaders.has("Strict-Transport-Security")) {
    responseHeaders.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
