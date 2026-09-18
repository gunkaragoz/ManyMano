import type { Config } from "@react-router/dev/config";

// React Router framework config (moved out of vite.config.ts in RR7).
// SSR stays on: every route renders on the edge Worker, as before.
export default {
  ssr: true,
} satisfies Config;
