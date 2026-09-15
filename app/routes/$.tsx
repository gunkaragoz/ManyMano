import type { MetaFunction } from "@remix-run/cloudflare";
import NotFound from "~/components/NotFound";
import { mergeParentMeta, pageMetaOverrides, rootSiteFromMatches } from "~/utils/seo";

export const meta: MetaFunction = ({ matches }) => {
  const site = rootSiteFromMatches(matches);
  return mergeParentMeta(matches, [
    ...pageMetaOverrides({
      title: `Page not found | ${site.siteName}`,
      description: "This link looks wrong. You'll be redirected to the main page shortly.",
      path: "/",
      robots: "noindex, nofollow",
      siteUrl: site.siteUrl,
    }),
  ]);
};

export default function CatchAll() {
  return (
    <NotFound
      title="This page couldn't be found"
      message="The link may be wrong, or the event was deleted or expired. You'll be taken back to the main page shortly."
    />
  );
}
