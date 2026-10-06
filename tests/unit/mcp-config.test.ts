import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loader as catalogLoader } from "~/routes/[.]well-known.ai-catalog[.]json";
import { loader as llmsLoader } from "~/routes/llms[.]txt";
import { MCP_TOOL_SUMMARIES } from "~/utils/mcp-discovery";
import { TOOL_NAMES } from "~/mcp/tools";
import { createSqliteD1 } from "./helpers/sqlite-d1";
import { SITE_URL, routeContext, testEnv } from "./helpers/route-harness";

const ROOT = process.cwd();
const wrangler = readFileSync(resolve(ROOT, "wrangler.toml"), "utf8");

/** Body of one TOML table, up to the next header. */
function table(name: string): string {
  const start = wrangler.indexOf(`\n${name}\n`);
  expect(start, `${name} missing`).toBeGreaterThan(-1);
  const rest = wrangler.slice(start + name.length + 2);
  const next = rest.search(/^\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

const value = (body: string, key: string) => body.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"))?.[1];

describe("MCP config", () => {
  const expected: Record<string, string> = {
    "[vars]": "false",
    "[env.production.vars]": "true",
    "[env.staging.vars]": "true",
    "[previews.vars]": "true",
    "[env.staging.previews.vars]": "true",
  };

  it("every Wrangler var block sets all three MCP vars with the intended enablement", () => {
    for (const [name, enabled] of Object.entries(expected)) {
      const body = table(name);
      expect(value(body, "MCP_ENABLED"), name).toBe(enabled);
      expect(value(body, "MCP_DAILY_LIMIT"), name).toBe("2000");
      expect(value(body, "MCP_WRITE_DAILY_LIMIT"), name).toBe("200");
    }
  });

  it(".env.sample documents the MCP vars, off by default", () => {
    const sample = readFileSync(resolve(ROOT, ".env.sample"), "utf8");
    expect(sample).toMatch(/^MCP_ENABLED="false"$/m);
    expect(sample).toMatch(/^MCP_DAILY_LIMIT=/m);
    expect(sample).toMatch(/^MCP_WRITE_DAILY_LIMIT=/m);
  });

  it("advertised tool names match the registered tools", () => {
    expect(MCP_TOOL_SUMMARIES.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });
});

describe("MCP discovery", () => {
  const load = async (loader: typeof catalogLoader, enabled: string | undefined) => {
    const env = testEnv(createSqliteD1(), { MCP_ENABLED: enabled });
    const res = (await loader({
      request: new Request(`${SITE_URL}/x`),
      params: {},
      context: routeContext(env),
    } as never)) as Response;
    return res.text();
  };

  it("the AI catalog lists a schema-shaped MCP entry only when enabled", async () => {
    expect(JSON.parse(await load(catalogLoader, "false")).entries).toEqual([]);
    const catalog = JSON.parse(await load(catalogLoader, "true"));
    expect(catalog.entries).toHaveLength(1);
    const entry = catalog.entries[0];
    // ARD 1.0 schema: required identifier/displayName/type, url XOR data.
    expect(entry.identifier).toMatch(/^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/);
    expect(entry.displayName).toBeTruthy();
    expect(entry.type).toBe("application/mcp-server-card+json");
    expect("url" in entry !== "data" in entry).toBe(true);
    expect(entry.data.remotes).toEqual([{ type: "streamable-http", url: `${SITE_URL}/mcp` }]);
    expect(JSON.stringify(catalog)).not.toMatch(/admin=/);
  });

  it("llms.txt mentions the MCP server only when enabled", async () => {
    expect(await load(llmsLoader, undefined)).not.toContain("/mcp");
    const text = await load(llmsLoader, "true");
    expect(text).toContain(`${SITE_URL}/mcp`);
    for (const name of TOOL_NAMES) expect(text).toContain(name);
  });
});
