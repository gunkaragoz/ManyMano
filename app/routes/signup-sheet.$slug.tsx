import { cloudflareContext } from "~/utils/cloudflare-context";
import { recordTemplateView } from "~/utils/template-popularity";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import TemplatePage, {
  TemplatePageErrorBoundary,
  loadTemplatePage,
  templatePageMeta,
} from "~/components/TemplatePage";
import { rootSiteFromMatches } from "~/utils/seo";

// /signup-sheet/<slug>: one sign-up sheet template (content lives in ~/utils/templates).
export const loader = async ({ params, request, context }: LoaderFunctionArgs) => {
  const page = loadTemplatePage(params.slug, "SIGNUP_SHEET");
  const { env, ctx } = context.get(cloudflareContext);
  // Advisory counter: nothing on the page depends on it, so it runs after the
  // response is sent instead of in front of it (waitUntil keeps it alive).
  ctx.waitUntil(recordTemplateView(env.DB, page.template.slug, request));
  return page;
};

export const meta: MetaFunction<typeof loader> = ({ matches, loaderData }) =>
  templatePageMeta(rootSiteFromMatches(matches), matches, loaderData);

export const ErrorBoundary = TemplatePageErrorBoundary;

export default TemplatePage;
