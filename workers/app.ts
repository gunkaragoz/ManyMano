import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext, type CloudflareEnv } from "../app/utils/cloudflare-context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    const loadContext = new RouterContextProvider();
    loadContext.set(cloudflareContext, {
      env,
      cf: request.cf as CfProperties,
      ctx: {
        waitUntil: ctx.waitUntil.bind(ctx),
        passThroughOnException: ctx.passThroughOnException.bind(ctx),
      },
      caches,
    });
    return requestHandler(request, loadContext);
  },
} satisfies ExportedHandler<CloudflareEnv>;
