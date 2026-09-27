import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import TemplatePage, {
  TemplatePageErrorBoundary,
  loadTemplatePage,
  templatePageMeta,
} from "~/components/TemplatePage";
import { rootSiteFromMatches } from "~/utils/seo";

// /meeting-poll/<slug>: one meeting poll template (content lives in ~/utils/templates).
export const loader = ({ params }: LoaderFunctionArgs) => loadTemplatePage(params.slug, "TIME_POLL");

export const meta: MetaFunction<typeof loader> = ({ matches, loaderData }) =>
  templatePageMeta(rootSiteFromMatches(matches), matches, loaderData);

export const ErrorBoundary = TemplatePageErrorBoundary;

export default TemplatePage;
