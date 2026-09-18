import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite 8 resolves tsconfig paths natively (replaces vite-tsconfig-paths).
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/contract/**/*.test.ts", "tests/bundle/**/*.test.ts"],
    exclude: ["node_modules", "build", "tests/staging/**"],
    testTimeout: 30000,
  },
});
