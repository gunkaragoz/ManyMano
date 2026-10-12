import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkerConfig } from "@cloudflare/vite-plugin";
import { estimateTokens, htmlToMarkdown } from "../app/utils/markdown";
import { PRERENDER_PAGES } from "../app/utils/prerender";

type BuildEnvironment = {
  CLOUDFLARE_ENV?: string;
  WORKERS_CI?: string;
  WORKERS_CI_BRANCH?: string;
};

export function publicPrerenderConfig(
  config: Partial<Pick<WorkerConfig, "vars" | "previews">>,
  env: BuildEnvironment
): Partial<WorkerConfig> {
  // main is the production branch; named Wrangler environments remain explicit.
  const preview = !env.CLOUDFLARE_ENV && env.WORKERS_CI === "1" &&
    !!env.WORKERS_CI_BRANCH && env.WORKERS_CI_BRANCH !== "main";
  if (preview && !config.previews?.vars?.SITE_URL) {
    throw new Error("Worker preview prerender requires previews.vars.SITE_URL.");
  }
  return {
    // Only public configuration belongs in the local prerender runtime.
    secrets: { required: [] },
    ...(preview ? { vars: { ...config.previews!.vars } } : {}),
  };
}

export async function finishPublicPrerender(buildDirectory: string): Promise<void> {
  const clientDirectory = join(buildDirectory, "client");
  const config = JSON.parse(await readFile(join(buildDirectory, "server", "wrangler.json"), "utf8"));
  const siteUrl = config.vars?.SITE_URL;
  if (!siteUrl) throw new Error("Prerender requires SITE_URL in the deployment config.");
  const headers = [await readFile(join(clientDirectory, "_headers"), "utf8")];
  await mkdir(join(clientDirectory, "_prerender"), { recursive: true });
  for (const page of PRERENDER_PAGES) {
    const html = await readFile(join(clientDirectory, page.html.slice(1)), "utf8");
    const pageUrl = new URL(page.path, siteUrl).href;
    // A local .dev.vars override must never leak into deployable HTML.
    if (!html.includes('<link rel="canonical" href="' + pageUrl + '"')) {
      throw new Error("Prerender canonical does not match deployment SITE_URL: " + page.path);
    }
    const markdown = htmlToMarkdown(html, pageUrl);
    await writeFile(join(clientDirectory, page.markdown.slice(1)), markdown);
    headers.push(
      page.markdown + "\n  Content-Type: text/markdown; charset=utf-8\n  x-markdown-tokens: " + estimateTokens(markdown) + "\n  X-Robots-Tag: index, follow",
      page.data + "\n  Content-Type: text/x-script; charset=utf-8"
    );
  }
  await writeFile(join(clientDirectory, "_headers"), headers.join("\n") + "\n");
}
