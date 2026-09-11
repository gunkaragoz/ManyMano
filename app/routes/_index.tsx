import { Link } from "@remix-run/react";

export default function Index() {
  return (
    <div className="space-y-12">
      {/* Hero Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto pt-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
          <span>⚡ Zero accounts required</span>
          <span>•</span>
          <span>100% Free on Cloudflare Pages</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
          Effortless Sign-Ups & Meeting Availability
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          The open-source, ad-free alternative to <strong>SignUpGenius</strong> and <strong>Doodle</strong>.
          Coordinate volunteers or pick the perfect meeting time in seconds.
        </p>
      </div>

      {/* Two Main Mode Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {/* Card 1: Volunteer Signups */}
        <div className="bg-white border border-slate-200 rounded-2xl p-7 shadow-sm hover:shadow-md hover:border-blue-300 transition-all flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-2xl font-bold">
              📋
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Volunteer Sign-Up Sheet</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Create customizable slot lists with capacity limits, shift times, and potluck items. Volunteers claim spots with zero login friction.
            </p>
            <ul className="space-y-2 text-xs text-slate-600 pt-2">
              <li className="flex items-center gap-2">
                <span className="text-emerald-600 font-bold">✓</span> Slot limits & live remaining count
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-600 font-bold">✓</span> Custom attendee questions (notes, sizes, items)
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-600 font-bold">✓</span> Organizer CSV export & calendar (.ics) sync
              </li>
            </ul>
          </div>

          <Link
            to="/create?type=SIGNUP_SHEET"
            className="w-full text-center py-3 px-4 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 shadow-sm transition-colors"
          >
            Create Sign-Up Sheet →
          </Link>
        </div>

        {/* Card 2: Meeting Time Finder */}
        <div className="bg-white border border-slate-200 rounded-2xl p-7 shadow-sm hover:shadow-md hover:border-blue-300 transition-all flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl font-bold">
              📅
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Meeting Time Finder</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              The classic Doodle consensus grid. Propose candidate dates and time slots, let participants vote Yes / (If need be) / No, and lock the winner.
            </p>
            <ul className="space-y-2 text-xs text-slate-600 pt-2">
              <li className="flex items-center gap-2">
                <span className="text-emerald-600 font-bold">✓</span> Classic Doodle matrix grid with fast clicking
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-600 font-bold">✓</span> Automatic participant time zone conversions
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-600 font-bold">✓</span> 1-Click finalization with calendar invite download
              </li>
            </ul>
          </div>

          <Link
            to="/create?type=TIME_POLL"
            className="w-full text-center py-3 px-4 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 shadow-sm transition-colors"
          >
            Create Meeting Poll →
          </Link>
        </div>
      </div>

      {/* Cloudflare 1-Click Banner */}
      <div className="max-w-4xl mx-auto bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-700">Self-Hostable Anywhere</span>
            <span className="px-2 py-0.5 rounded-full bg-blue-200 text-blue-800 text-[10px] font-bold">1-Click Deploy</span>
          </div>
          <h3 className="text-xl font-bold text-slate-900">Deploy to Cloudflare Pages & D1 for $0/mo</h3>
          <p className="text-xs sm:text-sm text-slate-600 max-w-xl">
            Fork this repository on GitHub and deploy directly to Cloudflare Pages. Comes configured with serverless SQLite (D1) and free transactional email support.
          </p>
        </div>
        <a
          href="https://deploy.workers.cloudflare.com/?url=https://github.com/manymano/manymano"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm shadow-md transition-colors"
        >
          <span>Deploy to Cloudflare</span>
          <span>⚡</span>
        </a>
      </div>
    </div>
  );
}
