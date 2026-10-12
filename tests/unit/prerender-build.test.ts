import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { finishPublicPrerender, publicPrerenderConfig } from "../../scripts/prerender-public-pages";
import { estimateTokens } from "~/utils/markdown";

const directories: string[] = [];

async function fixture(renderedOrigin = "https://example.com", siteUrl = "https://example.com") {
  const directory = await mkdtemp(join(tmpdir(), "manymano-prerender-test-"));
  directories.push(directory);
  await mkdir(join(directory, "server"), { recursive: true });
  await mkdir(join(directory, "client", "templates"), { recursive: true });
  await writeFile(join(directory, "server", "wrangler.json"), JSON.stringify({ vars: { SITE_URL: siteUrl } }));
  await writeFile(join(directory, "client", "_headers"), "/*\n  X-Content-Type-Options: nosniff\n");
  for (const [file, path] of [["index.html", "/"], ["templates/index.html", "/templates"]]) {
    const html = '<html><head><title>Public page</title><link rel="canonical" href="' +
      renderedOrigin + path + '"></head><body><main><h1>Public page</h1><a href="/create">Create</a></main></body></html>';
    await writeFile(join(directory, "client", file), html);
  }
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("public prerender build", () => {
  const config = {
    vars: { SITE_URL: "https://example.com", SITE_NAME: "Production", SMTP_HOST: "production-mail.example.com" },
    previews: { vars: { SITE_URL: "https://preview.example.com", SITE_NAME: "Preview" } },
  };

  it("uses preview vars for branch builds without mixing production-only vars", async () => {
    const selected = publicPrerenderConfig(config, { WORKERS_CI: "1", WORKERS_CI_BRANCH: "fix/cpu" });
    expect(selected.vars).toEqual(config.previews.vars);
    expect(selected.vars).not.toHaveProperty("SMTP_HOST");
    expect(config.vars.SITE_NAME).toBe("Production");
    const directory = await fixture("https://preview.example.com", selected.vars!.SITE_URL as string);
    await finishPublicPrerender(directory);
    const markdown = await readFile(join(directory, "client", "_prerender", "home.md"), "utf8");
    expect(markdown).toContain('url: "https://preview.example.com/"');
    expect(markdown).not.toContain("https://example.com");
  });

  it.each([
    {},
    { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" },
    { WORKERS_CI: "1", WORKERS_CI_BRANCH: "fix/cpu", CLOUDFLARE_ENV: "production" },
    { WORKERS_CI: "1", WORKERS_CI_BRANCH: "fix/cpu", CLOUDFLARE_ENV: "staging" },
  ])("preserves selected deployment vars for %j", (env) => {
    const selected = publicPrerenderConfig(config, env);
    expect(selected).not.toHaveProperty("vars");
    expect(selected.secrets).toEqual({ required: [] });
  });

  it("fails closed when a branch preview has no canonical origin configured", () => {
    expect(() => publicPrerenderConfig({ vars: config.vars }, {
      WORKERS_CI: "1", WORKERS_CI_BRANCH: "fix/cpu",
    })).toThrow("Worker preview prerender requires previews.vars.SITE_URL");
  });

  it("precomputes Markdown using the deployment origin and emits token/data headers", async () => {
    const directory = await fixture();
    await finishPublicPrerender(directory);
    const markdown = await readFile(join(directory, "client", "_prerender", "templates.md"), "utf8");
    expect(markdown).toContain('url: "https://example.com/templates"');
    expect(markdown).toContain("[Create](https://example.com/create)");
    const headers = await readFile(join(directory, "client", "_headers"), "utf8");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("x-markdown-tokens: " + estimateTokens(markdown));
    expect(headers).toContain("/templates.data\n  Content-Type: text/x-script; charset=utf-8");
  });

  it("rejects a build that rendered local overrides into the HTML", async () => {
    await expect(finishPublicPrerender(await fixture("http://localhost:5189"))).rejects.toThrow(
      "Prerender canonical does not match deployment SITE_URL"
    );
  });
});
