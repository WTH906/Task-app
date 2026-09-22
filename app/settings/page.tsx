"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSettings } from "@/lib/hooks/useSettings";
import { FeaturePicker } from "@/components/FeaturePicker";
import { FeatureMap } from "@/lib/features";
import { useToast } from "@/components/Toast";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { SlidersHorizontal, RotateCcw, BookOpen } from "lucide-react";

export default function SettingsPage() {
  const { features, loaded, setFeatures, restartOnboarding } = useSettings();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const router = useRouter();
  const [draft, setDraft] = useState<FeatureMap | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { document.title = "Comfy Board — Settings"; }, []);

  // Adopt the loaded values once, without clobbering an in-progress edit.
  useEffect(() => { if (loaded && !draft) setDraft(features); }, [loaded, features, draft]);

  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(features);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    await setFeatures(draft);
    setSaving(false);
    toast("Settings saved", "success");
  };

  if (!loaded || !draft) {
    return <div className="p-8 text-txt3">Loading…</div>;
  }

  return (
    <div className="page-shell page-shell--readable pb-32">
      <div className="mb-6">
        <h1 className="font-title text-2xl text-bright flex items-center gap-2">
          <SlidersHorizontal size={20} /> Settings
        </h1>
        <p className="text-sm text-txt2 mt-1">
          Signed in as <span className="text-txt">{user?.email}</span>
        </p>
      </div>

      {/*
        Help comes first. The feature list below it is long and getting
        longer, so anything underneath it is effectively hidden — and someone
        opening Settings because they don't understand a feature is exactly
        the person who needs the guide, not a wall of toggles.
      */}
      <section className="mb-8 space-y-2">
        <h2 className="text-sm font-medium text-bright mb-2">Help</h2>
        <button
          onClick={() => router.push("/guide")}
          className="w-full flex items-center gap-3 p-3 rounded-lg bg-surface border border-border hover:border-border2 transition-colors text-left"
        >
          <BookOpen size={16} className="text-violet2 shrink-0" />
          <span>
            <span className="block text-sm text-txt">Read the guide</span>
            <span className="block text-xs text-txt3">How the pieces fit together, in five short sections.</span>
          </span>
        </button>
        <button
          onClick={async () => { await restartOnboarding(); router.push("/"); }}
          className="w-full flex items-center gap-3 p-3 rounded-lg bg-surface border border-border hover:border-border2 transition-colors text-left"
        >
          <RotateCcw size={16} className="text-violet2 shrink-0" />
          <span>
            <span className="block text-sm text-txt">Run the first-run guide again</span>
            <span className="block text-xs text-txt3">Including the feature picker and the example project.</span>
          </span>
        </button>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-bright mb-1">Features</h2>
        <p className="text-xs text-txt3 mb-4">
          Turn off anything you don&apos;t use — it disappears from the sidebar, the
          dashboard and every task row. Your data stays exactly where it is.
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
          <span className="text-xs text-txt3 mr-auto ml-2">Unsaved changes</span>
          <button onClick={() => setDraft(features)}
            className="px-3 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3 transition-colors">
            Discard
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: "var(--accent)" }}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}
