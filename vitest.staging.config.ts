import { defineConfig } from "vitest/config";

// Staging-only run: `pnpm run test:staging` with STAGING_URL set.
// Excluded from the default `vitest run` so unit/contract/bundle stay hermetic.
export default defineConfig({
  // Vite 8 resolves tsconfig paths natively (replaces vite-tsconfig-paths).
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/staging/**/*.test.ts"],
    testTimeout: 60000,
  },
});
