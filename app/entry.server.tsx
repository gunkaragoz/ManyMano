import type { AppLoadContext, EntryContext } from "@remix-run/cloudflare";
import { RemixServer } from "@remix-run/react";
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
    <RemixServer context={remixContext} url={request.url} />,
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
  // App hardening: no referrer leaks of ?admin=, no framing.
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
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
