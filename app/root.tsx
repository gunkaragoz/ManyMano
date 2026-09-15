import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  Link,
  useLoaderData,
  useLocation,
  useNavigation,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import { HeartHandshake } from "lucide-react";
import NotFound from "~/components/NotFound";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function BrandName({ name }: { name: string }) {
  if (name.toLowerCase() === "manymano") {
    return (
      <>
        <span className="text-blue-600">{name.slice(0, 4)}</span>
        <span className="text-green-600">{name.slice(4)}</span>
      </>
    );
  }
  return <>{name}</>;
}
import stylesheet from "~/tailwind.css?url";
import {
  CREATE_STICKY_HEADER_EVENT,
  formatStickyDate,
  type CreateStickyHeaderDetail,
} from "~/utils/useCreateStickyHeader";
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  absoluteUrl,
  organizationJsonLd,
  softwareAppJsonLd,
  websiteJsonLd,
} from "~/utils/seo";
import { getSiteConfig, toPublicSiteConfig } from "~/utils/site";

export async function loader({ context }: LoaderFunctionArgs) {
  // Fail-fast: missing SITE_* env throws here instead of serving stale brand.
  const config = getSiteConfig(context.cloudflare.env);
  return json({ site: toPublicSiteConfig(config) });
}

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
  { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
  { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
];

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.site) throw new Error("[config] Root loader must provide `site` (SITE_URL/SITE_NAME).");
  const { site } = data;
  const siteUrl = site.siteUrl;
  const siteName = site.siteName;
  const tagline = site.siteTagline;
  const ogTitle = `${siteName} - ${tagline}`;
  const ogImage = absoluteUrl("/og-cover.png", siteUrl);
  return [
    { charset: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: ogTitle },
    {
      name: "description",
      content: site.siteDescription,
    },
    { tagName: "link", rel: "canonical", href: siteUrl + "/" },
    { name: "robots", content: "index, follow" },
    { name: "theme-color", content: "#ffffff" },
    { name: "application-name", content: siteName },
    // Open Graph
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: siteName },
    { property: "og:title", content: ogTitle },
    { property: "og:description", content: site.siteTagline },
    { property: "og:url", content: siteUrl + "/" },
    { property: "og:image", content: ogImage },
    { property: "og:image:width", content: String(OG_IMAGE_WIDTH) },
    { property: "og:image:height", content: String(OG_IMAGE_HEIGHT) },
    { property: "og:image:alt", content: ogTitle },
    { property: "og:locale", content: "en_US" },
    // Twitter
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: ogTitle },
    { name: "twitter:description", content: site.siteTagline },
    { name: "twitter:image", content: ogImage },
  ];
};

export function ErrorBoundary() {
  const error = useRouteError();

  // 404 (wrong link / deleted event) and 410 (expired event): show the
  // friendly notice and redirect to the main page after 20 seconds.
  if (isRouteErrorResponse(error) && (error.status === 404 || error.status === 410)) {
    const isGone = error.status === 410;
    return (
      <html lang="en" className="h-full">
        <head>
          <Meta />
          <Links />
        </head>
        <body className="flex flex-col min-h-screen bg-[#fafafc] text-slate-900">
          <main className="flex-1 max-w-5xl w-full mx-auto px-6 sm:px-8 py-8 md:py-12">
            <NotFound
              title={isGone ? "This event is no longer available" : "This page couldn't be found"}
              message={
                isGone
                  ? "This event expired and was automatically deleted. You'll be taken back to the main page shortly."
                  : "The link may be wrong, or the event was deleted or expired. You'll be taken back to the main page shortly."
              }
            />
          </main>
          <ScrollRestoration />
          <Scripts />
        </body>
      </html>
    );
  }

  // Unexpected errors: no auto-redirect (don't mask real 500s).
  const message =
    isRouteErrorResponse(error)
      ? `Something went wrong (${error.status}).`
      : error instanceof Error
        ? error.message
        : "Something went wrong.";
  return (
    <html lang="en" className="h-full">
      <head>
        <Meta />
        <Links />
      </head>
      <body className="flex flex-col min-h-screen bg-[#fafafc] text-slate-900">
        <main className="flex-1 max-w-5xl w-full mx-auto px-6 sm:px-8 py-8 md:py-12">
          <div className="max-w-xl mx-auto text-center py-12">
            <div className="bg-white border border-slate-200/80 rounded-3xl px-8 py-10 space-y-4">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Something went wrong
              </h1>
              <p className="text-sm text-slate-600">{message}</p>
              <Link
                to="/"
                className="inline-block py-2.5 px-5 rounded-2xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-all"
              >
                Go to main page
              </Link>
            </div>
          </div>
        </main>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { site } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const location = useLocation();
  const isLoading = navigation.state !== "idle";

  // Readonly Meeting/Event Title + Date shown in the nav header once the
  // create-form title field has been scrolled out of view. Child create
  // routes broadcast via `manymano:create-sticky-header` CustomEvent.
  const [stickyHeader, setStickyHeader] = useState<{ title: string; date: string } | null>(null);

  useEffect(() => {
    const onSticky = (e: Event) => {
      const detail = (e as CustomEvent<CreateStickyHeaderDetail>).detail;
      if (!detail) return;
      if (detail.visible && (detail.title.trim() || detail.date.trim())) {
        setStickyHeader({ title: detail.title, date: detail.date });
      } else {
        setStickyHeader(null);
      }
    };
    window.addEventListener(CREATE_STICKY_HEADER_EVENT, onSticky);
    return () => window.removeEventListener(CREATE_STICKY_HEADER_EVENT, onSticky);
  }, []);

  // Clear when navigating away (the emitting page also clears on unmount).
  useEffect(() => {
    setStickyHeader(null);
  }, [location.pathname]);

  return (
    <html lang="en" className="h-full">
      <head>
        <Meta />
        <Links />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              organizationJsonLd(site.siteUrl, site.siteName, site.githubRepoUrl),
              websiteJsonLd(site.siteUrl, site.siteName, site.siteTagline),
              softwareAppJsonLd(site.siteUrl, site.siteName, site.siteDescription),
            ]),
          }}
        />
      </head>
      <body className="flex flex-col min-h-screen bg-[#fafafc] text-slate-900 selection:bg-blue-100 selection:text-blue-900">
        {isLoading && (
          <div className="fixed top-0 left-0 right-0 h-0.5 bg-blue-600 z-50 animate-pulse" />
        )}

        {/* Global Minimal Navigation */}
        <header className="sticky top-0 z-40 bg-[#fafafc]/80 backdrop-blur-md border-b border-slate-200/80 transition-all">
          <div className="max-w-5xl mx-auto px-6 sm:px-8 h-18 py-4 flex items-center justify-between gap-3">
            <Link to="/" className="flex items-center gap-3 group shrink-0">
              <div className="w-8 h-8 rounded-lg bg-white border-2 border-blue-600 flex items-center justify-center text-green-600 shadow-sm group-hover:bg-blue-50 transition-colors">
                <HeartHandshake className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-bold text-base tracking-tight text-slate-900">
                  <BrandName name={site.siteName} />
                </span>
                <span className="hidden sm:block text-[11px] font-medium text-slate-500 tracking-tight">
                  {site.siteTagline}
                </span>
              </div>
            </Link>

            <div
              aria-hidden={!stickyHeader}
              data-testid="create-sticky-header"
              aria-readonly="true"
              title={
                stickyHeader
                  ? `${stickyHeader.title}${stickyHeader.date ? ` • ${formatStickyDate(stickyHeader.date)}` : ""}`
                  : undefined
              }
              className={`min-w-0 flex-1 hidden sm:flex justify-center transition-all duration-200 ${
                stickyHeader ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
              }`}
            >
              {stickyHeader && (
                <div className="min-w-0 max-w-md flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-slate-200/80 shadow-sm text-xs">
                  <span className="min-w-0 truncate font-semibold text-slate-800">
                    {stickyHeader.title.trim() || "Untitled"}
                  </span>
                  {stickyHeader.date.trim() && (
                    <>
                      <span aria-hidden="true" className="shrink-0 text-slate-300">
                        •
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        {formatStickyDate(stickyHeader.date)}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            <nav className="flex items-center gap-4 shrink-0">
              <Link
                to="/create"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-full bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <span>+</span>
                <span>Create Event</span>
              </Link>
            </nav>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-5xl w-full mx-auto px-6 sm:px-8 py-8 md:py-12">
          <Outlet />
        </main>

        {/* Minimal Clean Footer */}
        <footer className="border-t border-slate-200/60 bg-white/60 py-8 mt-16">
          <div className="max-w-5xl mx-auto px-6 sm:px-8 flex flex-col gap-6 text-xs text-slate-500">
            <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-slate-600 font-medium">
              <Link to="/create/signup" className="hover:text-slate-900 transition-colors">
                Create sign-up sheet
              </Link>
              <Link to="/create/poll" className="hover:text-slate-900 transition-colors">
                Create meeting poll
              </Link>
              <Link to="/create" className="hover:text-slate-900 transition-colors">
                How it works
              </Link>
              <Link to="/pulse" className="hover:text-slate-900 transition-colors">
                Pulse
              </Link>
              <a href="/#faq" className="hover:text-slate-900 transition-colors">
                FAQ
              </a>
            </nav>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900"><BrandName name={site.siteName} /></span>
              <span>—</span>
              <span>{site.siteTagline}</span>
            </div>
            <div className="flex items-center gap-5 text-slate-400">
              {site.footerCreditUrl && site.footerCreditLabel && (
                <a
                  href={site.footerCreditUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-slate-900 transition-colors font-medium text-slate-600"
                >
                  {site.footerCreditLabel}
                </a>
              )}
              {site.githubRepoUrl && (
                <a
                  href={site.githubRepoUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub"
                  className="hover:text-slate-900 transition-colors font-medium text-slate-600"
                >
                  <GithubIcon className="w-5 h-5" />
                </a>
              )}
            </div>
          </div>
          </div>
        </footer>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
