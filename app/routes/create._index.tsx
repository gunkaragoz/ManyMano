import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { ArrowRight, CalendarDays, ClipboardList } from "lucide-react";
import {
  getPageMeta,
  breadcrumbJsonLd,
  mergeParentMeta,
  pageMetaOverrides,
  rootSiteFromMatches,
} from "~/utils/seo";

export const meta: MetaFunction = ({ matches }) => {
  const site = rootSiteFromMatches(matches);
  const page = getPageMeta(site.siteName).createChooser;
  return mergeParentMeta(matches, [
    ...pageMetaOverrides({ ...page, siteUrl: site.siteUrl }),
    {
      "script:ld+json": breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Create", path: "/create" },
      ], site.siteUrl),
    },
  ]);
};

export default function CreateChooser() {
  return (
    <div className="max-w-2xl mx-auto space-y-8 py-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">What would you like to create?</h1>
        <p className="text-sm text-slate-500">
          Choose between organizing shifts with a sign-up sheet or seeing which meeting time works best.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
        {/* Card 1: Sign-Up Sheet */}
        <Link
          to="/create/signup"
          className="group bg-white border border-slate-200/80 rounded-3xl p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-blue-300 transition-all flex flex-col justify-between space-y-6"
        >
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 group-hover:scale-105 transition-transform">
              <ClipboardList className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Sign-Up Sheet</h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Create customizable shifts with multiple tasks and potluck lists with specific spot limits.
            </p>
          </div>
          <span className="text-xs font-bold text-blue-600 flex items-center gap-1">
            <span>Create Sheet</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>

        {/* Card 2: Meeting Poll */}
        <Link
          to="/create/poll"
          className="group bg-white border border-slate-200/80 rounded-3xl p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-green-300 transition-all flex flex-col justify-between space-y-6"
        >
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center border border-green-100 group-hover:scale-105 transition-transform">
              <CalendarDays className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Meeting Time Finder</h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Propose times and let everyone vote Yes, Maybe, or No to see which works best.
            </p>
          </div>
          <span className="text-xs font-bold text-green-600 flex items-center gap-1">
            <span>Create Poll</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>
      </div>
    </div>
  );
}
