import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("wrangler.toml", "utf8");
function section(name: string): string {
  return source.split("[" + name + "]\n")[1]?.split("\n[")[0] ?? "";
}

describe("production logging configuration", () => {
  it.each(["observability", "env.production.observability"])(
    "keeps included sampling and query-string redaction for %s", (name) => {
      expect(section(name)).toMatch(/^enabled = true$/m);
      expect(section(name)).toMatch(/^redact_query_string = true$/m);
      expect(section(name + ".logs")).toMatch(/^enabled = true$/m);
      expect(section(name + ".logs")).toMatch(/^invocation_logs = true$/m);
      expect(section(name + ".logs")).toMatch(/^head_sampling_rate = 0\.1$/m);
      expect(section(name + ".traces")).toMatch(/^enabled = true$/m);
      expect(section(name + ".traces")).toMatch(/^head_sampling_rate = 0\.01$/m);
    }
  );

  it.each(["previews.observability", "env.staging.observability", "env.staging.previews.observability"])(
    "keeps %s disabled", (name) => {
      expect(section(name)).toMatch(/^enabled = false$/m);
    }
  );
});
