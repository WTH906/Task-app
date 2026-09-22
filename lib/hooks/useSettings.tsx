"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";
import { createClient } from "@/lib/supabase";
import {
  DEFAULT_FEATURES, FeatureKey, FeatureMap, normalizeFeatures,
} from "@/lib/features";

interface SettingsValue {
  features: FeatureMap;
  /** True once the DB round trip has resolved. Gate first-run UI on this. */
  loaded: boolean;
  onboarded: boolean;
  /** Convenience: `has("contacts")`. */
  has: (key: FeatureKey) => boolean;
  setFeature: (key: FeatureKey, value: boolean) => Promise<void>;
  setFeatures: (next: FeatureMap) => Promise<void>;
  /** Pass the picker's draft so it can't be clobbered by a stale write. */
  completeOnboarding: (next?: FeatureMap) => Promise<void>;
  restartOnboarding: () => Promise<void>;
}

const SettingsContext = createContext<SettingsValue | null>(null);

/** localStorage mirror, so the first paint doesn't flash the default set. */
const CACHE_KEY = "comfy-features";

function readCache(): FeatureMap | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normalizeFeatures(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function SettingsProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  const [features, setFeaturesState] = useState<FeatureMap>(() => readCache() ?? DEFAULT_FEATURES);
  const [onboarded, setOnboarded] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) { setLoaded(true); return; }
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      const { data, error } = await supabase
        .from("user_settings")
        .select("features, onboarded_at")
        .eq("user_id", userId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        // Most likely migration v21 hasn't been run yet. Fall back to
        // defaults rather than blocking the whole app behind a settings read.
        console.error("[settings:load]", error.message);
        setLoaded(true);
        return;
      }

      const next = normalizeFeatures(data?.features ?? null);
      setFeaturesState(next);
      setOnboarded(!!data?.onboarded_at);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [userId]);

  const persist = useCallback(async (next: FeatureMap, onboardedAt?: string | null) => {
    setFeaturesState(next);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    window.dispatchEvent(new Event("features-changed"));
    if (!userId) return;

    const supabase = createClient();
    const row: Record<string, unknown> = {
      user_id: userId, features: next, updated_at: new Date().toISOString(),
    };
    if (onboardedAt !== undefined) row.onboarded_at = onboardedAt;

    const { error } = await supabase.from("user_settings").upsert(row, { onConflict: "user_id" });
    if (error) console.error("[settings:save]", error.message);
  }, [userId]);

  const setFeature = useCallback(async (key: FeatureKey, value: boolean) => {
    await persist(normalizeFeatures({ ...features, [key]: value }));
  }, [features, persist]);

  const setFeatures = useCallback(async (next: FeatureMap) => {
    await persist(normalizeFeatures(next));
  }, [persist]);

  const completeOnboarding = useCallback(async (next?: FeatureMap) => {
    setOnboarded(true);
    // One write, not two. Calling setFeatures() and then completeOnboarding()
    // separately wrote the picker's choices and then immediately overwrote
    // them with the pre-edit `features` captured in this closure.
    await persist(normalizeFeatures(next ?? features), new Date().toISOString());
  }, [features, persist]);

  const restartOnboarding = useCallback(async () => {
    setOnboarded(false);
    await persist(features, null);
  }, [features, persist]);

  const value = useMemo<SettingsValue>(() => ({
    features, loaded, onboarded,
    has: (k: FeatureKey) => features[k],
    setFeature, setFeatures, completeOnboarding, restartOnboarding,
  }), [features, loaded, onboarded, setFeature, setFeatures, completeOnboarding, restartOnboarding]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/**
 * Read the current feature set.
 *
 * Safe to call outside the provider (e.g. the login page) — it returns the
 * defaults with `loaded: false` rather than throwing.
 */
export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (ctx) return ctx;
  const noop = async () => {};
  return {
    features: DEFAULT_FEATURES, loaded: false, onboarded: true,
    has: (k: FeatureKey) => DEFAULT_FEATURES[k],
    setFeature: noop, setFeatures: noop,
    completeOnboarding: noop, restartOnboarding: noop,
  };
}
