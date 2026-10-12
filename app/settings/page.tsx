"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSettings } from "@/lib/hooks/useSettings";
import { FeaturePicker } from "@/components/FeaturePicker";
import { FeatureMap } from "@/lib/features";
import { useToast } from "@/components/Toast";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { SlidersHorizontal, RotateCcw, BookOpen, Globe } from "lucide-react";
import { useLocale, Locale } from "@/lib/i18n/useLocale";

export default function SettingsPage() {
  const { features, loaded, setFeatures, restartOnboarding } = useSettings();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { locale, setLocale, t } = useLocale();
  const router = useRouter();
  const [draft, setDraft] = useState<FeatureMap | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { document.title = `Comfy Board — ${t("settings.title")}`; }, [locale]);

  // Adopt the loaded values once, without clobbering an in-progress edit.
  useEffect(() => { if (loaded && !draft) setDraft(features); }, [loaded, features, draft]);

  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(features);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    await setFeatures(draft);
    setSaving(false);
    toast(t("settings.saved"), "success");
  };

  if (!loaded || !draft) {
    return <div className="p-8 text-txt3" role="status">Loading…</div>;
  }

  return (
    <div className="page-shell page-shell--readable pb-32">
      <div className="mb-6">
        <h1 className="font-title text-2xl text-bright flex items-center gap-2">
          <SlidersHorizontal size={20} /> {t("settings.title")}
        </h1>
        <p className="text-sm text-txt2 mt-1">
          {t("settings.signedInAs")} <span className="text-txt">{user?.email}</span>
        </p>
      </div>

      {/*
        Help comes first. The feature list below it is long and getting
        longer, so anything underneath it is effectively hidden — and someone
        opening Settings because they don't understand a feature is exactly
        the person who needs the guide, not a wall of toggles.
      */}
      <section className="mb-8 space-y-2">
        <h2 className="text-sm font-medium text-bright mb-2">{t("settings.help")}</h2>
        <button
          onClick={() => router.push("/guide")}
          className="w-full flex items-center gap-3 p-3 rounded-lg bg-surface border border-border hover:border-border2 transition-colors text-left"
        >
          <BookOpen size={16} className="text-violet2 shrink-0" />
          <span>
            <span className="block text-sm text-txt">{t("settings.readGuide")}</span>
            <span className="block text-xs text-txt3">{t("settings.readGuideHint")}</span>
          </span>
        </button>
        <button
          onClick={async () => { await restartOnboarding(); router.push("/"); }}
          className="w-full flex items-center gap-3 p-3 rounded-lg bg-surface border border-border hover:border-border2 transition-colors text-left"
        >
          <RotateCcw size={16} className="text-violet2 shrink-0" />
          <span>
            <span className="block text-sm text-txt">{t("settings.restartGuide")}</span>
            <span className="block text-xs text-txt3">{t("settings.restartGuideHint")}</span>
          </span>
        </button>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-bright mb-2 flex items-center gap-2">
          <Globe size={14} /> {t("settings.language")}
        </h2>
        <div className="flex gap-2">
          {(["en", "fr"] as Locale[]).map((l) => (
            <button key={l} onClick={() => setLocale(l)}
              className="px-4 py-2 rounded-lg text-sm border transition-colors"
              style={{
                borderColor: locale === l ? "var(--accent)" : "var(--border)",
                backgroundColor: locale === l ? "color-mix(in srgb, var(--accent) 13%, transparent)" : "transparent",
                color: locale === l ? "var(--accent2)" : "var(--txt2)",
              }}>
              {l === "en" ? "English" : "Français"}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-bright mb-1">{t("settings.features")}</h2>
        <p className="text-xs text-txt3 mb-4">
          {t("settings.featuresDescription")}
        </p>
        <FeaturePicker value={draft} onChange={setDraft} />
      </section>

      {/*
        Save bar — only appears when there's something to save.

        Its left inset follows --sidebar-w rather than a hardcoded 15rem, so
        the bar tracks the sidebar when it's collapsed instead of leaving a
        dead gutter down the left of the screen. Below md the sidebar is an
        overlay, hence the `left-0` base with the variable applied at md+.
      */}
      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 md:left-[var(--sidebar-w)] border-t border-border p-3 flex items-center justify-end gap-3 z-40"
          style={{ backgroundColor: "var(--surface2)" }}>
          <span className="text-xs text-txt3 mr-auto ml-2">{t("settings.unsavedChanges")}</span>
          <button onClick={() => setDraft(features)}
            className="px-3 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3 transition-colors">
            {t("common.discard")}
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm text-on-accent disabled:opacity-50 transition-colors"
            style={{ backgroundColor: "var(--accent)" }}>
            {saving ? t("common.saving") : t("settings.saveChanges")}
          </button>
        </div>
      )}
    </div>
  );
}
