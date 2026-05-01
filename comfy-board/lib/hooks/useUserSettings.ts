"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";

interface UserSettings {
  monthly_routine_enabled: boolean;
  dashboard_card_order: string[] | null;
}

const DEFAULT_SETTINGS: UserSettings = {
  monthly_routine_enabled: false,
  dashboard_card_order: null,
};

/**
 * Hook to read/write user settings from Supabase user_settings table.
 * Falls back to localStorage during load and for clients without the table.
 * Emits "settings-changed" event for cross-component sync.
 */
export function useUserSettings(userId: string | null) {
  const [settings, setSettings] = useState<UserSettings>(() => {
    // Immediate fallback from localStorage
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    return {
      monthly_routine_enabled: localStorage.getItem("comfy-monthly-routine") === "true",
      dashboard_card_order: (() => {
        try { return JSON.parse(localStorage.getItem("dashboard-card-order") || "null"); } catch { return null; }
      })(),
    };
  });
  const [loaded, setLoaded] = useState(false);

  // Fetch from DB on mount
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const s: UserSettings = {
            monthly_routine_enabled: data.monthly_routine_enabled ?? false,
            dashboard_card_order: data.dashboard_card_order ?? null,
          };
          setSettings(s);
          // Sync localStorage cache
          localStorage.setItem("comfy-monthly-routine", String(s.monthly_routine_enabled));
          if (s.dashboard_card_order) {
            localStorage.setItem("dashboard-card-order", JSON.stringify(s.dashboard_card_order));
          }
        }
        setLoaded(true);
      });
  }, [userId]);

  const updateSetting = useCallback(async <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    if (!userId) return;
    setSettings((prev) => ({ ...prev, [key]: value }));

    // Sync localStorage immediately
    if (key === "monthly_routine_enabled") {
      localStorage.setItem("comfy-monthly-routine", String(value));
      window.dispatchEvent(new Event("monthly-routine-changed"));
    }
    if (key === "dashboard_card_order") {
      localStorage.setItem("dashboard-card-order", JSON.stringify(value));
    }

    // Upsert to DB
    const supabase = createClient();
    await supabase.from("user_settings").upsert({
      user_id: userId,
      [key]: value,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  }, [userId]);

  return { settings, loaded, updateSetting };
}
