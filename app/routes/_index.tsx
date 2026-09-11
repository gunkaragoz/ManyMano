import { Link } from "@remix-run/react";
import { ArrowRight, CalendarDays, Check, ClipboardList } from "lucide-react";

export default function Index() {
  return (
    <div className="space-y-16 py-4 md:py-8">
      {/* Hero Section */}
      <div className="text-center space-y-5 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-100/80 border border-slate-200/80 text-slate-600 text-xs font-medium tracking-wide">
          <span>No sign-up needed</span>
          <span className="text-slate-300">•</span>
          <span>No ads or tracking</span>
          <span className="text-slate-300">•</span>
          <span>Free forever</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.15]">
          Coordinate people <br className="hidden sm:inline" />
          <span className="text-blue-600">without the chaos.</span>
        </h1>

        <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl mx-auto font-normal">
          Sign-up sheets and meeting polls in seconds.
          No accounts, no ads, no hassle.
        </p>
      </div>

      {/* Two Mode Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {/* Card 1: Sign-Up Sheet */}
        <div className="bg-white border border-slate-200/80 rounded-3xl p-8 sm:p-10 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-blue-200 transition-all duration-200 flex flex-col justify-between space-y-8">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <ClipboardList className="w-6 h-6" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Sign-Up Sheets</h2>
              <p className="text-sm text-slate-500 leading-relaxed">
                Slot limits, shifts, potluck food lists, and community tasks. People claim spots instantly with zero account signup.
              </p>
            </div>

            <ul className="space-y-2.5 text-xs text-slate-600 pt-2">
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center"><Check className="w-3 h-3" /></span>
                <span>Automatic slot limits & real-time spots remaining</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center"><Check className="w-3 h-3" /></span>
                <span>Custom attendee questions (equipment, notes, sizes)</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center"><Check className="w-3 h-3" /></span>
                <span>Secret organizer link with 1-click CSV roster export</span>
              </li>
            </ul>
          </div>

          <Link
            to="/create/signup"
            className="w-full text-center py-3.5 px-5 rounded-2xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] inline-flex items-center justify-center gap-2"
          >
            Create Sign-Up Sheet <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Card 2: Meeting Time Finder */}
        <div className="bg-white border border-slate-200/80 rounded-3xl p-8 sm:p-10 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-emerald-200 transition-all duration-200 flex flex-col justify-between space-y-8">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <CalendarDays className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Meeting Time Finder</h2>
              <p className="text-sm text-slate-500 leading-relaxed">
                A clean consensus grid without ads or spam. Propose dates, let everyone vote Yes / If need be / No, and lock the winner.
              </p>
            </div>

            <ul className="space-y-2.5 text-xs text-slate-600 pt-2">
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center"><Check className="w-3 h-3" /></span>
                <span>Responsive consensus matrix with fast 1-click voting</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center"><Check className="w-3 h-3" /></span>
                <span>Automatic local time zone conversion for attendees</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center"><Check className="w-3 h-3" /></span>
                <span>Real-time consensus star & calendar (.ics) sync</span>
              </li>
            </ul>
          </div>

          <Link
            to="/create/poll"
            className="w-full text-center py-3.5 px-5 rounded-2xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] inline-flex items-center justify-center gap-2"
          >
            Create Meeting Poll <ArrowRight className="w-4 h-4" />
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
            <div className="text-sm font-bold text-slate-900">2. No accounts needed</div>
            <p className="text-xs text-slate-500">No passwords or sign-ups. Just create, share, you're done.</p>
          </div>
          <div className="space-y-1.5 p-4">
            <div className="text-sm font-bold text-slate-900">3. Free forever</div>
            <p className="text-xs text-slate-500">No paywalls or feature limits. Open source on GitHub.</p>
          </div>
        </div>
      </div>

    </div>
  );
}
