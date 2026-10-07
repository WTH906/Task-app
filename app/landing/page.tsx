import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Comfy Board — The task app that adapts to you",
  description:
    "Plan your week, track routines, manage projects, and stay on top of deadlines — all in one app that shows only the features you need.",
  openGraph: {
    title: "Comfy Board",
    description: "The task app that adapts to you",
    url: "https://comfyboard.app",
    siteName: "Comfy Board",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Comfy Board",
    description: "The task app that adapts to you",
  },
};

const THEMES = [
  { name: "Purple", bg: "#322a56", accent: "#cebcff", dot: "#cebcff" },
  { name: "Ocean", bg: "#1a3050", accent: "#43B8FA", dot: "#43B8FA" },
  { name: "Emerald", bg: "#163028", accent: "#34d399", dot: "#34d399" },
  { name: "Ember", bg: "#302820", accent: "#f0a050", dot: "#f0a050" },
  { name: "Rose", bg: "#342430", accent: "#f472b6", dot: "#f472b6" },
  { name: "Frost", bg: "#eaeff6", accent: "#3b82f6", dot: "#3b82f6" },
  { name: "Cloud", bg: "#fdfcfa", accent: "#6d28d9", dot: "#6d28d9" },
  { name: "Dawn", bg: "#f2ece2", accent: "#d07818", dot: "#d07818" },
];

const FEATURES = [
  {
    title: "Feature toggles",
    desc: "Start simple. Turn on what you need — routines, time tracking, stats, contacts — and hide the rest. Your app, your rules.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
        <rect x="1" y="5" width="22" height="14" rx="7" />
        <circle cx="16" cy="12" r="4" fill="currentColor" opacity="0.3" />
      </svg>
    ),
  },
  {
    title: "Week planner with hour grid",
    desc: "Drag tasks into time blocks. See your week at a glance. Schedule down to the minute or keep it loose — both work.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <line x1="9" y1="4" x2="9" y2="22" />
        <line x1="15" y1="4" x2="15" y2="22" />
      </svg>
    ),
  },
  {
    title: "Four routine layers",
    desc: "Daily, weekly, monthly, yearly. Each with its own view, its own checks, its own rhythm. Not everything repeats the same way.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    ),
  },
  {
    title: "Quick capture",
    desc: "Press A. Type \"finish proposal friday p2\". It parses the date and priority, drops it in your inbox. No menus, no clicks.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
    ),
  },
  {
    title: "Built-in time tracking",
    desc: "Per-task timers that remember where you left off. A separate work clock for your total day. Stats that compare estimates to reality.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    title: "Retro planning",
    desc: "Pick a deadline. Work backwards. The app lays out what needs to happen when — because real planning starts from the end.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
        <polyline points="1 4 1 10 7 10" />
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      </svg>
    ),
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-5 max-w-6xl mx-auto">
        <span className="font-title text-xl font-semibold text-bright tracking-tight">
          Comfy Board
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-txt2 hover:text-bright transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium px-4 py-2 rounded-xl transition-all"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 md:px-12 pt-16 md:pt-24 pb-20 max-w-6xl mx-auto">
        <div className="max-w-2xl">
          <h1 className="font-title text-4xl md:text-5xl lg:text-6xl font-semibold text-bright leading-[1.1] tracking-tight">
            The task app that
            <br />
            <span style={{ color: "var(--accent)" }}>adapts to you</span>
          </h1>
          <p className="mt-6 text-lg text-txt2 leading-relaxed max-w-lg">
            Plan your week. Track your routines. Manage projects. Stay on
            deadlines. Turn features on when you need them, off when you
            don&apos;t. One app, your way.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/login"
              className="text-base font-medium px-6 py-3 rounded-xl transition-all hover:scale-[1.02]"
              style={{ background: "var(--accent)", color: "var(--bg)" }}
            >
              Start for free
            </Link>
            <span className="text-sm text-txt3">No credit card needed</span>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="px-6 md:px-12 py-16 max-w-6xl mx-auto">
        <h2 className="font-title text-2xl md:text-3xl font-semibold text-bright mb-3">
          Not another generic planner
        </h2>
        <p className="text-txt3 mb-10 max-w-lg">
          Most task apps give you their workflow. This one gives you yours.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="glass-panel p-5 hover:border-[color-mix(in_srgb,var(--glass-text)_30%,transparent)] transition-colors"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                style={{
                  background:
                    "color-mix(in srgb, var(--accent) 15%, transparent)",
                  color: "var(--accent)",
                }}
              >
                {f.icon}
              </div>
              <h3 className="font-medium text-bright text-sm mb-1.5">
                {f.title}
              </h3>
              <p className="text-txt3 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Themes showcase */}
      <section className="px-6 md:px-12 py-16 max-w-6xl mx-auto">
        <h2 className="font-title text-2xl md:text-3xl font-semibold text-bright mb-3">
          Eight palettes, not just dark mode
        </h2>
        <p className="text-txt3 mb-8 max-w-lg">
          Pick the one that feels right. Every theme runs through every surface,
          every glass panel, every background.
        </p>

        <div className="flex flex-wrap gap-3">
          {THEMES.map((t) => (
            <div
              key={t.name}
              className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl border transition-colors"
              style={{
                background: t.bg,
                borderColor: `${t.accent}30`,
              }}
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ background: t.dot }}
              />
              <span
                className="text-xs font-medium"
                style={{
                  color: t.name === "Cloud" || t.name === "Frost" || t.name === "Dawn"
                    ? "#2a2a28"
                    : "#e6e0f6",
                }}
              >
                {t.name}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Also section */}
      <section className="px-6 md:px-12 py-16 max-w-6xl mx-auto">
        <h2 className="font-title text-2xl md:text-3xl font-semibold text-bright mb-8">
          Also in the box
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-5">
          {[
            ["Contacts", "Built-in address book with tags — no separate CRM needed"],
            ["Follow-ups", "Flag a task as \"waiting on someone\" and track it in one panel"],
            ["Stats", "Streaks, time breakdowns, estimate accuracy — know how you actually work"],
            ["Roadmaps", "Milestones and phases for longer projects, linked to your tasks"],
            ["Keyboard-first", "20+ shortcuts — D for dashboard, A for capture, ⌘K for search"],
            ["Deadlines", "Live countdowns with recurrence support"],
            ["Templates", "Save a project structure, reuse it next time"],
            ["Drag everything", "Reorder tasks, move between projects, schedule onto the hour grid"],
          ].map(([title, desc]) => (
            <div key={title} className="py-2">
              <h3 className="text-sm font-medium text-bright">{title}</h3>
              <p className="text-xs text-txt3 mt-1 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="px-6 md:px-12 py-20 max-w-6xl mx-auto text-center">
        <h2 className="font-title text-3xl md:text-4xl font-semibold text-bright mb-4">
          Ready to try it?
        </h2>
        <p className="text-txt2 mb-8 max-w-md mx-auto">
          Free to start. Set up in under a minute. No credit card, no
          onboarding quiz, no 14-day countdown.
        </p>
        <Link
          href="/login"
          className="inline-block text-base font-medium px-8 py-3.5 rounded-xl transition-all hover:scale-[1.02]"
          style={{ background: "var(--accent)", color: "var(--bg)" }}
        >
          Get started free
        </Link>
      </section>

      {/* Footer */}
      <footer className="px-6 md:px-12 py-8 max-w-6xl mx-auto border-t border-border/30">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-txt3">
          <span className="font-title text-sm text-txt2">Comfy Board</span>
          <div className="flex items-center gap-5">
            <span>&copy; {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
