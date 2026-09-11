import { Link } from "@remix-run/react";

export default function CreateChooser() {
  return (
    <div className="max-w-2xl mx-auto space-y-8 py-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">What would you like to create?</h1>
        <p className="text-sm text-slate-500">
          Choose between organizing volunteer shifts or finding consensus on a meeting time.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
        {/* Card 1: Volunteer Sheet */}
        <Link
          to="/create/signup"
          className="group bg-white border border-slate-200/80 rounded-3xl p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-blue-300 transition-all flex flex-col justify-between space-y-6"
        >
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl font-bold border border-blue-100 group-hover:scale-105 transition-transform">
              📋
            </div>
            <h2 className="text-xl font-bold text-slate-900">Volunteer Sign-Up Sheet</h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Create customizable shifts, roles, and potluck lists with specific spot limits.
            </p>
          </div>
          <span className="text-xs font-bold text-blue-600 flex items-center gap-1">
            <span>Create Sheet</span>
            <span>→</span>
          </span>
        </Link>

        {/* Card 2: Meeting Poll */}
        <Link
          to="/create/poll"
          className="group bg-white border border-slate-200/80 rounded-3xl p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-emerald-300 transition-all flex flex-col justify-between space-y-6"
        >
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl font-bold border border-emerald-100 group-hover:scale-105 transition-transform">
              📅
            </div>
            <h2 className="text-xl font-bold text-slate-900">Meeting Time Finder</h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Propose candidate time slots on a clean Doodle grid and let everyone vote.
            </p>
          </div>
          <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
            <span>Create Poll</span>
            <span>→</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
