"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useSettings } from "@/lib/hooks/useSettings";
import { FeaturePicker } from "@/components/FeaturePicker";
import { FeatureMap } from "@/lib/features";
import { useToast } from "@/components/Toast";
import { formatDate, addDays } from "@/lib/utils";
import { syncTaskDeadlineToDeadlines } from "@/lib/sync";
import { useLocale } from "@/lib/i18n/useLocale";
import { CalendarDays, Timer, ListChecks, Folder, Zap } from "lucide-react";

/**
 * First-run guide — five steps, skippable, and re-runnable from /settings.
 *
 * Two deliberate choices:
 *
 * 1. It is NOT a gate. Upfront carousels retain badly because you're asking
 *    someone to memorise a system before they have anything to attach it to.
 *    Every step can be skipped, and the same content lives permanently at
 *    /guide so it's findable later, when it will actually mean something.
 *
 * 2. Step 3 is the feature picker rather than more explanation. Asking
 *    "which of these do you want?" teaches the feature set by making the
 *    reader consider each one, and sets sane defaults at the same time.
 *
 * Only two concepts genuinely need teaching, and they get a step each:
 * work-on vs due, and routines vs projects.
 */

const STEPS = 5;

export function OnboardingModal({ userId }: { userId: string }) {
  const { loaded, onboarded, features, completeOnboarding } = useSettings();
  const { t } = useLocale();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<FeatureMap | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const current = draft ?? features;

  // Single write — the draft goes in with the onboarding flag.
  const finish = useCallback(async () => {
    await completeOnboarding(draft ?? undefined);
  }, [draft, completeOnboarding]);

  /** Create a small worked example. People learn from a filled-in artifact. */
  const seedExample = useCallback(async () => {
    if (seeding || seeded) return;
    setSeeding(true);
    const supabase = createClient();
    try {
      const { data: project, error: pErr } = await supabase.from("projects").insert({
        user_id: userId, title: "Example project", description:
          "A worked example so you can see how the pieces fit. Delete it whenever you like.",
        color: "#7c6fff", sort_order: 0,
      }).select().single();
      if (pErr || !project) throw new Error(pErr?.message ?? "insert failed");

      const today = formatDate(new Date());
      const { data: task, error: tErr } = await supabase.from("project_tasks").insert({
        project_id: project.id, user_id: userId,
        name: "Try checking this off from the planner",
        est_minutes: 45, date_key: today, deadline: formatDate(addDays(new Date(), 3)),
        progress: 0, notes: "Scheduled for today, due in three days.",
        elapsed_seconds: 0, sort_order: 0,
      }).select().single();
      if (tErr || !task) throw new Error(tErr?.message ?? "insert failed");

      await supabase.from("subtasks").insert([
        { task_id: task.id, user_id: userId, name: "Subtasks roll up into the task's progress",
          est_minutes: 20, progress: 0, notes: "", sort_order: 0 },
        { task_id: task.id, user_id: userId, name: "Tick both and the task completes itself",
          est_minutes: 25, progress: 0, notes: "", sort_order: 1 },
      ]);

      await supabase.from("week_tasks").insert({
        user_id: userId, date_key: today, text: task.name, done: false,
        project_id: project.id, project_task_id: task.id, sort_order: 0,
      });

      // The deadline column alone doesn't create a countdown — the deadlines
      // table does. Without this the example contradicts what step 2 just said.
      await syncTaskDeadlineToDeadlines(
        supabase, userId, task.id, task.name, project.title,
        formatDate(addDays(new Date(), 3))
      );

      setSeeded(true);
      toast(t("onboarding.exampleCreated"), "success");
      window.dispatchEvent(new Event("projects-changed"));
    } catch (err) {
      console.error("[onboarding:seed]", err);
      toast(t("onboarding.exampleFailed"), "error");
    }
    setSeeding(false);
  }, [seeding, seeded, userId, toast, t]);

  if (!loaded || onboarded) return null;

  const next = () => setStep((s) => Math.min(s + 1, STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
      role="dialog" aria-modal="true" aria-label={t("onboarding.welcome")}>
      <div className="w-full max-w-lg rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        style={{ backgroundColor: "var(--surface2)", position: "relative" }}>

        {/* Progress */}
        <div className="flex gap-1 px-5 pt-5 shrink-0">
          {Array.from({ length: STEPS }, (_, i) => (
            <div key={i} className="h-0.5 flex-1 rounded-full transition-colors"
              style={{ backgroundColor: i <= step ? "var(--accent)" : "var(--surface3)" }} />
          ))}
        </div>

        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {step === 0 && (
            <div>
              <h2 className="font-title text-2xl text-bright mb-2">{t("onboarding.welcome")}</h2>
              <p className="text-sm text-txt2 leading-relaxed mb-5">
                {t("onboarding.welcomeBody")}
              </p>
              <div className="space-y-3">
                <div className="flex gap-3 items-start p-3 rounded-lg bg-surface border border-border">
                  <ListChecks size={18} className="text-violet2 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-bright">{t("guide.shape.routinesTitle")}</p>
                    <p className="text-xs text-txt3">{t("onboarding.routinesShort")}</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start p-3 rounded-lg bg-surface border border-border">
                  <Folder size={18} className="text-violet2 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-bright">{t("guide.shape.projectsTitle")}</p>
                    <p className="text-xs text-txt3">{t("onboarding.projectsShort")}</p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-txt3 mt-4">
                {t("onboarding.separatePoint")}
              </p>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="font-title text-xl text-bright mb-2">{t("onboarding.dates")}</h2>
              <p className="text-sm text-txt2 leading-relaxed mb-5">
                {t("onboarding.datesBody")}
              </p>
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-surface border border-border">
                  <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-surface3 text-txt2 w-fit mb-2">
                    <CalendarDays size={12} /> <span className="text-txt3">{t("guide.dates.workOn")}</span> {t("common.today").toLowerCase()}
                  </span>
                  <p className="text-xs text-txt3">
                    {t("onboarding.workOnBody")}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface border border-border">
                  <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-amber/50 text-amber w-fit mb-2">
                    <Timer size={12} /> <span className="text-txt3">{t("guide.dates.due")}</span> {t("day.friday")}
                  </span>
                  <p className="text-xs text-txt3">
                    {t("onboarding.dueBody")}
                  </p>
                </div>
              </div>
              <p className="text-xs text-txt3 mt-4">
                {t("onboarding.datesBoth")}
              </p>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="font-title text-xl text-bright mb-2">{t("onboarding.pickFeatures")}</h2>
              <p className="text-sm text-txt2 leading-relaxed mb-5">
                {t("onboarding.pickFeaturesBody")}
              </p>
              <FeaturePicker value={current} onChange={setDraft} compact />
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="font-title text-xl text-bright mb-2">{t("onboarding.capture")}</h2>
              <p className="text-sm text-txt2 leading-relaxed mb-5">
                {t("onboarding.captureBody")}
              </p>
              <div className="rounded-lg border border-border overflow-hidden mb-4" style={{ backgroundColor: "var(--surface)" }}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-txt3 text-lg" aria-hidden>＋</span>
                  <span className="text-txt text-sm">{t("onboarding.captureExample")}</span>
                </div>
                <div className="px-4 py-2 border-t border-border/60 text-[11px] text-violet2">
                  {t("onboarding.captureExampleParsed")} · <span className="font-mono">{t("onboarding.captureExampleDate")}</span> · P1
                </div>
              </div>
              <p className="text-xs text-txt3">
                {t("onboarding.captureHint")}
              </p>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="font-title text-xl text-bright mb-2">{t("onboarding.done")}</h2>
              <p className="text-sm text-txt2 leading-relaxed mb-5">
                {t("onboarding.doneBody", { guide: t("nav.guide") })}
              </p>
              <button
                onClick={seedExample}
                disabled={seeding || seeded}
                className="w-full flex items-center gap-3 p-3 rounded-lg bg-surface border border-border hover:border-violet/50 transition-colors text-left disabled:opacity-60"
              >
                <Zap size={18} className="text-violet2 shrink-0" />
                <span>
                  <span className="block text-sm text-bright">
                    {seeded ? t("onboarding.exampleCreated") : seeding ? t("onboarding.exampleCreating") : t("onboarding.exampleCreate")}
                  </span>
                  <span className="block text-xs text-txt3">
                    {seeded
                      ? t("onboarding.exampleCreatedHint")
                      : t("onboarding.exampleCreateHint")}
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border shrink-0">
          <button onClick={finish} className="text-xs text-txt3 hover:text-txt2 transition-colors">
            {step === STEPS - 1 ? "" : t("onboarding.skip")}
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button onClick={back}
                className="px-3 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3 transition-colors">
                {t("onboarding.back")}
              </button>
            )}
            {step < STEPS - 1 ? (
              <button onClick={next}
                className="px-4 py-2 rounded-lg text-sm text-on-accent transition-colors"
                style={{ backgroundColor: "var(--accent)" }}>
                {step === 2 ? t("onboarding.saveAndContinue") : t("onboarding.next")}
              </button>
            ) : (
              <button
                onClick={async () => { await finish(); router.push("/"); }}
                className="px-4 py-2 rounded-lg text-sm text-on-accent transition-colors"
                style={{ backgroundColor: "var(--accent)" }}>
                {t("onboarding.start")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
