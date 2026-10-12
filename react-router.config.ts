import type { Config } from "@react-router/dev/config";
import { PRERENDER_PAGES } from "./app/utils/prerender";
import { finishPublicPrerender } from "./scripts/prerender-public-pages";

// Public pages render once at build time; event and form routes keep SSR.
export default {
  ssr: true,
  prerender: PRERENDER_PAGES.map((page) => page.path),
  buildEnd: ({ reactRouterConfig }) => finishPublicPrerender(reactRouterConfig.buildDirectory),
} satisfies Config;
