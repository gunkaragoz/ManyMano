import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/contract/**/*.test.ts", "tests/bundle/**/*.test.ts"],
    exclude: ["node_modules", "build", "tests/staging/**"],
    testTimeout: 30000,
  },
});
