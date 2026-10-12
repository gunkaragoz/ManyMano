import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import { setDocumentSecurityHeaders } from "~/utils/document-headers";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: RouterContextProvider
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
  setDocumentSecurityHeaders(responseHeaders);
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
