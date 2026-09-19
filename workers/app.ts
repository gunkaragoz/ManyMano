import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext, type CloudflareEnv } from "../app/utils/cloudflare-context";
import { getDb } from "../app/db";
import { getSiteConfig } from "../app/utils/site";
import { reminderDateString } from "../app/utils/reminders";
import { runReminderFanout } from "../app/utils/reminders-run";

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

  // Daily reminder fan-out (see [triggers] in wrangler.toml — 06:00 UTC).
  // Runs in-worker: no HTTP, no REMINDER_SECRET needed. Dedupe via
  // reminder_sends rows makes overlapping runs safe. Staging has no cron
  // trigger configured, so this only ever fires in production.
  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    const cron = controller.cron;
    ctx.waitUntil(
      (async () => {
        const site = getSiteConfig(env);
        const result = await runReminderFanout(getDb(env.DB), env.DB, site, env, {
          date: reminderDateString(),
          dryRun: false,
        });
        console.log(
          `[reminders] cron ${cron}: ${result.totals.events} events, ` +
            `${result.totals.organizerSent} organizer + ${result.totals.participantSent} participant sent, ` +
            `${result.totals.participantFailed} failed`
        );
      })().catch((err) => {
        console.error(`[reminders] cron ${cron} failed:`, err);
      })
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
