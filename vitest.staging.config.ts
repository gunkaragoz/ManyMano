import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Staging-only run: `pnpm run test:staging` with STAGING_URL set.
// Excluded from the default `vitest run` so unit/contract/bundle stay hermetic.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/staging/**/*.test.ts"],
    testTimeout: 60000,
  },
});
