import { Link } from "@remix-run/react";

export default function Index() {
  return (
    <div className="space-y-16 py-4 md:py-8">
      {/* Hero Section */}
      <div className="text-center space-y-5 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-100/80 border border-slate-200/80 text-slate-600 text-xs font-medium tracking-wide">
          <span>Zero accounts needed</span>
          <span className="text-slate-300">•</span>
          <span>No ads or tracking</span>
          <span className="text-slate-300">•</span>
          <span>Free on Cloudflare</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.15]">
          Coordinate people <br className="hidden sm:inline" />
          <span className="text-blue-600">without the chaos.</span>
        </h1>

        <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl mx-auto font-normal">
          The clean, open-source alternative to SignUpGenius and Doodle.
          Collect volunteers or find the best meeting time in seconds.
        </p>
      </div>

      {/* Two Mode Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* Card 1: Volunteer Signups */}
        <div className="bg-white border border-slate-200/80 rounded-3xl p-8 sm:p-10 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-blue-200 transition-all duration-200 flex flex-col justify-between space-y-8">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl font-bold border border-blue-100">
              📋
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Volunteer Sign-Ups</h2>
              <p className="text-sm text-slate-500 leading-relaxed">
                Slot limits, shifts, potluck food lists, and community tasks. Volunteers claim spots instantly with zero account signup.
              </p>
            </div>

            <ul className="space-y-2.5 text-xs text-slate-600 pt-2">
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">✓</span>
                <span>Automatic slot limits & real-time spots remaining</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">✓</span>
                <span>Custom attendee questions (equipment, notes, sizes)</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">✓</span>
                <span>Secret organizer link with 1-click CSV roster export</span>
              </li>
            </ul>
          </div>

          <Link
            to="/create/signup"
            className="w-full text-center py-3.5 px-5 rounded-2xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            Create Sign-Up Sheet →
          </Link>
        </div>

        {/* Card 2: Meeting Time Finder */}
        <div className="bg-white border border-slate-200/80 rounded-3xl p-8 sm:p-10 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-emerald-200 transition-all duration-200 flex flex-col justify-between space-y-8">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl font-bold border border-emerald-100">
              📅
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Meeting Time Finder</h2>
              <p className="text-sm text-slate-500 leading-relaxed">
                The classic Doodle consensus grid without ads or spam. Propose dates, let everyone vote Yes / If need be / No, and lock the winner.
              </p>
            </div>

            <ul className="space-y-2.5 text-xs text-slate-600 pt-2">
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">✓</span>
                <span>Responsive Doodle matrix with fast 1-click voting</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">✓</span>
                <span>Automatic local time zone conversion for attendees</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold">✓</span>
                <span>Real-time consensus star & calendar (.ics) sync</span>
              </li>
            </ul>
          </div>

          <Link
            to="/create/poll"
            className="w-full text-center py-3.5 px-5 rounded-2xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            Create Meeting Poll →
          </Link>
        </div>
      </div>

      {/* Trust & Simplicity Highlights */}
      <div className="max-w-4xl mx-auto pt-6 border-t border-slate-200/60">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
          <div className="space-y-1.5 p-4">
            <div className="text-sm font-bold text-slate-900">1. Instant Share</div>
            <p className="text-xs text-slate-500">Every event gets a public link to share and a secret link to manage.</p>
          </div>
          <div className="space-y-1.5 p-4">
            <div className="text-sm font-bold text-slate-900">2. Privacy First</div>
            <p className="text-xs text-slate-500">No passwords, no data selling, no advertising trackers.</p>
          </div>
          <div className="space-y-1.5 p-4">
            <div className="text-sm font-bold text-slate-900">3. 100% Free Hosting</div>
            <p className="text-xs text-slate-500">Runs within Cloudflare's generous free tier with zero ongoing costs.</p>
          </div>
        </div>
      </div>

      {/* Cloudflare Deploy Footnote */}
      <div className="max-w-3xl mx-auto bg-slate-100/60 border border-slate-200/60 rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-600">
        <div>
          <strong className="text-slate-800">Want to host your own instance?</strong> Deploy ManyMano to Cloudflare Pages & D1 in 1 click.
        </div>
        <a
          href="https://deploy.workers.cloudflare.com/?url=https://github.com/manymano/manymano"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 px-4 py-2 bg-white border border-slate-300/80 rounded-xl font-semibold text-slate-800 hover:border-blue-500 hover:text-blue-600 shadow-sm transition-all"
        >
          Deploy to Cloudflare ⚡
        </a>
      </div>
    </div>
  );
}
