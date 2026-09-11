import type { LinksFunction, MetaFunction } from "@remix-run/cloudflare";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  Link,
  useNavigation,
} from "@remix-run/react";
import stylesheet from "~/tailwind.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

export const meta: MetaFunction = () => [
  { charset: "utf-8" },
  { name: "viewport", content: "width=device-width, initial-scale=1" },
  { title: "ManyMano — Simple, Fast Sign-Ups & Meeting Polls" },
  {
    name: "description",
    content:
      "A free, easy-to-use open-source tool for throwaway volunteer sign-ups and meeting polls. No accounts, auto-deletes after 90 days.",
  },
];

export default function App() {
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

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
          <div className="max-w-5xl mx-auto px-6 sm:px-8 h-18 py-4 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-sm group-hover:bg-blue-700 transition-colors">
                M
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-slate-900">
                  ManyMano
                </span>
                <span className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/60">
                  free & open source
                </span>
              </div>
            </Link>

            <nav className="flex items-center gap-4">
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
              <span>Free, easy throwaway coordination. No accounts, auto-deletes after 90 days.</span>
            </div>
            <div className="flex items-center gap-5 text-slate-400">
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
