"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n/useLocale";
import {
  BookOpen, CalendarDays, Timer, ListChecks, Folder, Zap, Gauge, SlidersHorizontal, Accessibility,
} from "lucide-react";

const SECTION_IDS = ["shape", "dates", "capture", "time", "tuning", "accessibility"];

export default function GuidePage() {
  const { t } = useLocale();
  const [active, setActive] = useState("shape");

  const sections = [
    { id: "shape", label: t("guide.shape.title"), icon: <BookOpen size={15} /> },
    { id: "dates", label: t("guide.dates.title"), icon: <CalendarDays size={15} /> },
    { id: "capture", label: t("guide.capture.title"), icon: <Zap size={15} /> },
    { id: "time", label: t("guide.time.title"), icon: <Gauge size={15} /> },
    { id: "tuning", label: t("guide.tuning.title"), icon: <SlidersHorizontal size={15} /> },
    { id: "accessibility", label: t("guide.a11y.title"), icon: <Accessibility size={15} /> },
  ];

  useEffect(() => { document.title = `Comfy Board — ${t("guide.title")}`; }, [t]);

  useEffect(() => {
    const els = SECTION_IDS.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b
        );
        setActive(top.target.id);
      },
      { rootMargin: "-10% 0px -60% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="page-shell page-shell--readable">
      <div className="mb-6">
        <h1 className="font-title text-2xl text-bright flex items-center gap-2">
          <BookOpen size={20} /> {t("guide.title")}
        </h1>
        <p className="text-sm text-txt2 mt-1">{t("guide.subtitle")}</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <nav className="md:w-52 shrink-0">
          <div className="md:sticky md:top-6 space-y-0.5">
            {sections.map((s) => (
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
            <h2 className="font-title text-lg text-bright mb-3">{t("guide.shape.title")}</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-4">
              {t("guide.shape.intro")}
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              <div className="p-4 rounded-xl bg-surface border border-border">
                <p className="flex items-center gap-2 text-sm text-bright mb-2"><ListChecks size={16} className="text-violet2" /> {t("guide.shape.routinesTitle")}</p>
                <p className="text-xs text-txt3 leading-relaxed">
                  {t("guide.shape.routinesDesc")}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface border border-border">
                <p className="flex items-center gap-2 text-sm text-bright mb-2"><Folder size={16} className="text-violet2" /> {t("guide.shape.projectsTitle")}</p>
                <p className="text-xs text-txt3 leading-relaxed">
                  {t("guide.shape.projectsDesc")}
                </p>
              </div>
            </div>
            <p className="text-sm text-txt2 leading-relaxed">
              {t("guide.shape.why")}
            </p>
            <p className="text-sm text-txt2 leading-relaxed mt-3">
              {t("guide.shape.planner")}
            </p>
          </section>

          <section id="dates" className="scroll-mt-6">
            <h2 className="font-title text-lg text-bright mb-3">{t("guide.dates.title")}</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-4">
              {t("guide.dates.intro")}
            </p>
            <div className="space-y-3 mb-4">
              <div className="p-4 rounded-xl bg-surface border border-border">
                <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-surface3 text-txt2 w-fit mb-2">
                  <CalendarDays size={12} /> <span className="text-txt3">{t("guide.dates.workOn")}</span> 2026-08-12
                </span>
                <p className="text-xs text-txt3 leading-relaxed">
                  {t("guide.dates.workOnDesc")}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface border border-border">
                <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-amber/50 text-amber w-fit mb-2">
                  <Timer size={12} /> <span className="text-txt3">{t("guide.dates.due")}</span> 2026-08-20
                </span>
                <p className="text-xs text-txt3 leading-relaxed">
                  {t("guide.dates.dueDesc")}
                </p>
              </div>
            </div>
            <p className="text-sm text-txt2 leading-relaxed">
              {t("guide.dates.eitherBoth")}
            </p>
            <p className="text-sm text-txt2 leading-relaxed mt-3">
              {t("guide.dates.repeating")}
            </p>
          </section>

          <section id="capture" className="scroll-mt-6">
            <h2 className="font-title text-lg text-bright mb-3">{t("guide.capture.title")}</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-4">
              {t("guide.capture.intro")}
            </p>
            <div className="rounded-xl border border-border overflow-hidden mb-4" style={{ backgroundColor: "var(--surface)" }}>
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="text-txt3 text-lg" aria-hidden>&#xFF0B;</span>
                <span className="text-txt text-sm">{t("guide.capture.example")}</span>
              </div>
              <div className="px-4 py-2 border-t border-border/60 text-[11px] text-violet2">
                {t("guide.capture.parsed")} &middot; <span className="font-mono">2026-08-25</span> &middot; P2
              </div>
            </div>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              {t("guide.capture.detects")}{" "}
              <span className="text-txt">{t("guide.capture.dateExamples")}</span>,{" "}
              <span className="text-txt">{t("guide.capture.priorityExamples")}</span>.{" "}
              {t("guide.capture.safe")}
            </p>
            <p className="text-sm text-txt2 leading-relaxed">
              {t("guide.capture.inbox")}
            </p>
          </section>

          <section id="time" className="scroll-mt-6">
            <h2 className="font-title text-lg text-bright mb-3">{t("guide.time.title")}</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              {t("guide.time.timer")}
            </p>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              {t("guide.time.stats")}
            </p>
            <p className="text-sm text-txt2 leading-relaxed">
              {t("guide.time.workClock")}
            </p>
          </section>

          <section id="tuning" className="scroll-mt-6">
            <h2 className="font-title text-lg text-bright mb-3">{t("guide.tuning.title")}</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              {t("guide.tuning.intro")}
            </p>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              {t("guide.tuning.safe")}
            </p>
            <p className="text-sm text-txt2 leading-relaxed mb-3">
              {t("guide.tuning.tips")}
            </p>
          </section>

          <section id="accessibility" className="scroll-mt-6">
            <h2 className="font-title text-lg text-bright mb-3">{t("guide.a11y.title")}</h2>
            <p className="text-sm text-txt2 leading-relaxed mb-4">
              {t("guide.a11y.intro")}
            </p>
            <div className="space-y-3 mb-4">
              <div className="p-4 rounded-xl bg-surface border border-border">
                <p className="text-sm text-bright mb-2">{t("guide.a11y.reorderTitle")}</p>
                <p className="text-xs text-txt3 leading-relaxed">
                  {t("guide.a11y.reorderDesc")}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface border border-border">
                <p className="text-sm text-bright mb-2">{t("guide.a11y.shortcutsTitle")}</p>
                <p className="text-xs text-txt3 leading-relaxed">
                  {t("guide.a11y.shortcutsDesc")}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-surface border border-border">
                <p className="text-sm text-bright mb-2">{t("guide.a11y.screenReadersTitle")}</p>
                <p className="text-xs text-txt3 leading-relaxed">
                  {t("guide.a11y.screenReadersDesc")}
                </p>
              </div>
            </div>
            <p className="text-sm text-txt2 leading-relaxed">
              {t("guide.a11y.feedback")}
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
