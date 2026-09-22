"use client";

import { FEATURES, FEATURE_GROUPS, FeatureMap } from "@/lib/features";
import { cn } from "@/lib/utils";

/**
 * The feature list, as a set of switches.
 *
 * Used in two places on purpose: as step 3 of the first-run guide, and
 * permanently on /settings. Asking "which of these do you want?" teaches the
 * feature set far better than a carousel explaining all of it — and it sets
 * the defaults at the same time.
 */
export function FeaturePicker({
  value, onChange, compact = false,
}: {
  value: FeatureMap;
  onChange: (next: FeatureMap) => void;
  compact?: boolean;
}) {
  const toggle = (key: keyof FeatureMap) => {
    onChange({ ...value, [key]: !value[key] });
  };

  return (
    <div className={compact ? "space-y-4" : "space-y-6"}>
      {FEATURE_GROUPS.map((group) => {
        const items = FEATURES.filter((f) => f.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <p className="text-[10px] uppercase tracking-widest text-txt3 mb-2">{group}</p>
            <div className="space-y-1">
              {items.map((f) => {
                const on = value[f.key];
                return (
                  <label
                    key={f.key}
                    className={cn(
                      "flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors border",
                      f.locked
                        ? "border-transparent opacity-60 cursor-default"
                        : "border-transparent hover:border-border hover:bg-surface2 cursor-pointer"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={f.locked}
                      onChange={() => !f.locked && toggle(f.key)}
                      aria-label={f.label}
                      className="mt-0.5 w-4 h-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className={cn("text-sm", on ? "text-bright" : "text-txt2")}>{f.label}</span>
                        {f.locked && (
                          <span className="text-[9px] uppercase tracking-wider text-txt3 border border-border rounded px-1 py-0.5">
                            always on
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-txt3 mt-0.5">{f.blurb}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-txt3">
        Switching something off only hides it — nothing is deleted, and turning it
        back on restores exactly what was there.
      </p>
    </div>
  );
}
