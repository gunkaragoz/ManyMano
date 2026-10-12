import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { estimateTokens, htmlToMarkdown } from "../app/utils/markdown";
import { PRERENDER_PAGES } from "../app/utils/prerender";

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
