import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext, type CloudflareEnv } from "../app/utils/cloudflare-context";
import { getDb } from "../app/db";
import { getSiteConfig } from "../app/utils/site";
import { runScheduledReminders } from "../app/utils/reminders-run";

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

  // Hourly reminder scan (see [triggers] in wrangler.toml). Each run sends
  // only what's due — 12 hours before the event starts (organizers +
  // participants) plus a 48h understaffed alert (organizers). Dedupe via
  // reminder_sends rows makes overlapping runs safe. Staging has no cron
  // trigger configured, so this only ever fires in production.
  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    const cron = controller.cron;
    ctx.waitUntil(
      (async () => {
        const site = getSiteConfig(env);
        const result = await runScheduledReminders(getDb(env.DB), env.DB, site, env, Date.now());
        console.log(
          `[reminders] cron ${cron}: ${result.totals.events} events due, ` +
            `${result.totals.organizerSent} organizer + ${result.totals.participantSent} participant sent, ` +
            `${result.totals.organizer48hSent} 48h alerts, ${result.totals.participantFailed} failed`
        );
      })().catch((err) => {
        console.error(`[reminders] cron ${cron} failed:`, err);
      })
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
