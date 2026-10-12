import { afterEach, describe, expect, it, vi } from "vitest";
import { loader as pollLoader } from "~/routes/create.poll";
import { loader as signupLoader } from "~/routes/create.signup";
import { createSqliteD1 } from "./helpers/sqlite-d1";
import { routeContext, testEnv } from "./helpers/route-harness";

afterEach(() => vi.useRealTimers());

describe("creation form hydration dates", () => {
  it.each([pollLoader, signupLoader])("supplies a stable UTC day around midnight", async (loader) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T00:01:00Z"));
    const db = createSqliteD1();
    try {
      const url = new URL("https://example.com/create/poll");
      const result = await loader({ url, context: routeContext(testEnv(db)) } as never);
      expect(result.data.initialToday).toBe("2026-10-12");
      // The serialized day survives a later client hydration or timezone change.
      vi.setSystemTime(new Date("2026-10-13T00:01:00Z"));
      expect(result.data.initialToday).toBe("2026-10-12");
    } finally {
      db.sqlite.close();
    }
  });
});
