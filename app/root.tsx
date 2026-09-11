import type { LinksFunction, MetaFunction } from "@remix-run/cloudflare";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  Link,
  useLocation,
  useNavigation,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import stylesheet from "~/tailwind.css?url";
import {
  CREATE_STICKY_HEADER_EVENT,
  formatStickyDate,
  type CreateStickyHeaderDetail,
} from "~/utils/useCreateStickyHeader";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

export const meta: MetaFunction = () => [
  { charset: "utf-8" },
  { name: "viewport", content: "width=device-width, initial-scale=1" },
  { title: "ManyMano — Sign-Up Sheets & Meeting Polls, No Account Needed" },
  {
    name: "description",
    content:
      "Free sign-up sheets and meeting polls. No accounts, no ads — create and share in seconds.",
  },
];

export default function App() {
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
      </head>
      <body className="flex flex-col min-h-screen bg-[#fafafc] text-slate-900 selection:bg-blue-100 selection:text-blue-900">
        {isLoading && (
          <div className="fixed top-0 left-0 right-0 h-0.5 bg-blue-600 z-50 animate-pulse" />
        )}

        {/* Global Minimal Navigation */}
        <header className="sticky top-0 z-40 bg-[#fafafc]/80 backdrop-blur-md border-b border-slate-200/80 transition-all">
          <div className="max-w-5xl mx-auto px-6 sm:px-8 h-18 py-4 flex items-center justify-between gap-3">
            <Link to="/" className="flex items-center gap-3 group shrink-0">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-sm group-hover:bg-blue-700 transition-colors">
                M
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-slate-900">
                  ManyMano
                </span>
                <span className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/60">
                  Free forever
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
          <div className="max-w-5xl mx-auto px-6 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">ManyMano</span>
              <span>—</span>
              <span>Free sign-up sheets & meeting polls. No accounts, no ads.</span>
            </div>
            <div className="flex items-center gap-5 text-slate-400">
              <a
                href="https://gnkz.net"
                target="_blank"
                rel="noreferrer"
                className="hover:text-slate-900 transition-colors font-medium text-slate-600"
              >
                gnkz.net
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-slate-900 transition-colors font-medium text-slate-600"
              >
                GitHub
              </a>
            </div>
          </div>
        </footer>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
