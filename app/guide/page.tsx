"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  BookOpen, CalendarDays, Timer, ListChecks, Folder, Zap, Gauge, SlidersHorizontal,
} from "lucide-react";

/**
 * The guide, as permanent reference rather than a first-run gate.
 *
 * Same five sections as the welcome flow. Upfront carousels are forgotten
 * because they arrive before the reader has anything to attach them to — so
 * the pages live here too, reachable from the sidebar forever, for the moment
 * someone actually wonders.
 */

const SECTIONS = [
  { id: "shape", label: "The shape of it", icon: <BookOpen size={15} /> },
  { id: "dates", label: "Two dates, two meanings", icon: <CalendarDays size={15} /> },
  { id: "capture", label: "Capturing things", icon: <Zap size={15} /> },
  { id: "time", label: "Time and estimates", icon: <Gauge size={15} /> },
  { id: "tuning", label: "Making it yours", icon: <SlidersHorizontal size={15} /> },
];

export default function GuidePage() {
  const [active, setActive] = useState("shape");

  useEffect(() => { document.title = "Comfy Board — Guide"; }, []);

  return (
    <div className="page-shell page-shell--readable">
      <div className="mb-6">
        <h1 className="font-title text-2xl text-bright flex items-center gap-2">
          <BookOpen size={20} /> Guide
        </h1>
        <p className="text-sm text-txt2 mt-1">Five short sections. Nothing you need to memorise.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Contents */}
        <nav className="md:w-52 shrink-0">
          <div className="md:sticky md:top-6 space-y-0.5">
            {SECTIONS.map((s) => (
              <a
                key={s.id} href={`#${s.id}`} onClick={() => setActive(s.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                  active === s.id ? "bg-violet/10 text-violet2" : "text-txt2 hover:bg-surface2 hover:text-txt"
                )}
              >
                {s.icon} {s.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="flex-1 min-w-0 space-y-8">

          <section id="shape" className="scroll-mt-6">
            <h2 className="font-title text-lg text-bright mb-3">The shape of it</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-4">
              Comfy Board keeps two kinds of work apart, on purpose.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              <div className="p-4 rounded-xl bg-surface border border-border">
                <p className="flex items-center gap-2 text-sm text-bright mb-2"><ListChecks size={16} className="text-violet2" /> Routines</p>
                <p className="text-xs text-txt3 leading-relaxed">
                  Things that come back. Four separate cadences — daily, weekly, monthly,
                  yearly — each with its own page and its own tick boxes that reset on their
                  own schedule.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface border border-border">
                <p className="flex items-center gap-2 text-sm text-bright mb-2"><Folder size={16} className="text-violet2" /> Projects</p>
                <p className="text-xs text-txt3 leading-relaxed">
                  Work with a beginning and an end. A project holds tasks; a task holds
                  subtasks. Ticking every subtask completes its task automatically.
                </p>
              </div>
            </div>
            <p className="text-sm text-txt2 leading-relaxed">
              Most tools model recurring work as just another task in the list, where it buries
              everything else. Keeping the two planes separate is what stops your maintenance
              from drowning your actual work.
            </p>
            <p className="text-sm text-txt2 leading-relaxed mt-3">
              The <Link href="/week" className="text-violet2 hover:underline">Planner</Link> is
              where both show up together — a week or month view of everything you&apos;ve
              scheduled, whichever plane it came from. Tick something off there and it&apos;s
              ticked off in its project too.
            </p>
          </section>

          <section id="dates" className="scroll-mt-6">
            <h2 className="font-title text-lg text-bright mb-3">Two dates, two meanings</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-4">
              The one thing worth learning. Every task can carry two dates, and they do
              different jobs.
            </p>
            <div className="space-y-3 mb-4">
              <div className="p-4 rounded-xl bg-surface border border-border">
                <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-surface3 text-txt2 w-fit mb-2">
                  <CalendarDays size={12} /> <span className="text-txt3">Work on</span> 2026-08-12
                </span>
                <p className="text-xs text-txt3 leading-relaxed">
                  When you intend to actually do it. This is what places the task on your
                  planner for that day. Change it and the task moves.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface border border-border">
                <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-amber/50 text-amber w-fit mb-2">
                  <Timer size={12} /> <span className="text-txt3">Due</span> 2026-08-20
                </span>
                <p className="text-xs text-txt3 leading-relaxed">
                  When it has to be finished. This creates a countdown on your{" "}
                  <Link href="/deadlines" className="text-violet2 hover:underline">Deadlines</Link> page.
                  It doesn&apos;t put anything on the planner.
                </p>
              </div>
            </div>
            <p className="text-sm text-txt2 leading-relaxed">
              A task can have either, both, or neither. Giving something a deadline of Friday
              and planning to work on it Wednesday is the normal case — and most tools have
              only one date field, which is why plans and deadlines end up tangled.
            </p>
            <p className="text-sm text-txt2 leading-relaxed mt-3">
              Set a date and a <span className="text-txt">Repeating?</span> option appears.
              A repeating task keeps rolling forward indefinitely — you don&apos;t need to
              re-create it.
            </p>
          </section>

          <section id="capture" className="scroll-mt-6">
            <h2 className="font-title text-lg text-bright mb-3">Capturing things</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-4">
              Press <kbd className="bg-surface3 px-1.5 py-0.5 rounded text-xs">A</kbd> anywhere
              in the app (or <kbd className="bg-surface3 px-1.5 py-0.5 rounded text-xs">Ctrl/⌘ + Shift + A</kbd> while
              you&apos;re typing). One field, no questions.
            </p>
            <div className="rounded-xl border border-border overflow-hidden mb-4" style={{ backgroundColor: "var(--surface)" }}>
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="text-txt3 text-lg" aria-hidden>＋</span>
                <span className="text-txt text-sm">Renew the domain in 2 weeks p2</span>
              </div>
              <div className="px-4 py-2 border-t border-border/60 text-[11px] text-violet2">
                Renew the domain · <span className="font-mono">2026-08-25</span> · P2
              </div>
            </div>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              It picks dates and priorities out of the sentence:
              <span className="text-txt"> today</span>,
              <span className="text-txt"> tomorrow</span>,
              <span className="text-txt"> friday</span>,
              <span className="text-txt"> next week</span>,
              <span className="text-txt"> in 3 days</span>,
              <span className="text-txt"> 20/08</span>,
              <span className="text-txt"> 2026-09-01</span>, and
              <span className="text-txt"> p1</span>–<span className="text-txt">p5</span>.
              If it isn&apos;t sure, it leaves your text alone.
            </p>
            <p className="text-sm text-txt2 leading-relaxed">
              Everything lands in your{" "}
              <Link href="/tasks" className="text-violet2 hover:underline">Task list</Link>, which is
              the inbox. Deciding what belongs to which project happens there, later — capturing
              and organising are separate jobs, and forcing them together is why people stop
              capturing.
            </p>
          </section>

          <section id="time" className="scroll-mt-6">
            <h2 className="font-title text-lg text-bright mb-3">Time and estimates</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              Every task and subtask has a <span className="text-txt">▶</span> button. It keeps
              running while you move around the app, survives a reload, and stops when you press
              it again.
            </p>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              Give a task an estimate as well, and{" "}
              <Link href="/stats" className="text-violet2 hover:underline">Stats</Link> will start
              comparing the two once you&apos;ve completed a few. That comparison is the useful
              part: not last time&apos;s raw hours, but how far off you personally tend to be, so
              your next estimate can be corrected before you commit to it.
            </p>
            <p className="text-sm text-txt2 leading-relaxed">
              The <span className="text-txt">Work clock</span> (off by default) is separate —
              it tracks your working day as a whole rather than any one task. The gap between
              the two is worth knowing.
            </p>
          </section>

          <section id="tuning" className="scroll-mt-6">
            <h2 className="font-title text-lg text-bright mb-3">Making it yours</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              There is more in Comfy Board than most people want on screen at once, so most of
              it starts switched off. Everything is listed in{" "}
              <Link href="/settings" className="text-violet2 hover:underline">Settings</Link> —
              turn things on as you find you want them.
            </p>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              Switching a feature off only hides it. Nothing is deleted, and turning it back on
              restores exactly what was there.
            </p>
            <p className="text-sm text-txt2 leading-relaxed">
              A few things worth trying once you&apos;re settled: drag dashboard cards to reorder
              them, drag a task onto a project in the sidebar to move it, and use{" "}
              <kbd className="bg-surface3 px-1.5 py-0.5 rounded text-xs">⌘K</kbd> to search
              everything at once.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
