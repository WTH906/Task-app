"use client";

import {
  createContext, useCallback, useContext, useEffect, useState,
} from "react";
import { en } from "./en";
import { fr } from "./fr";

export type Locale = "en" | "fr";
export type MessageKey = keyof typeof en;

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, fr };
const LOCALE_KEY = "comfy-locale";

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === "en" || stored === "fr") return stored;
  } catch { /* SSR or blocked storage */ }
  const nav = navigator.language.slice(0, 2);
  return nav === "fr" ? "fr" : "en";
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
  t: (key) => en[key] ?? String(key),
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(LOCALE_KEY, l); } catch { /* blocked */ }
    document.documentElement.lang = l;
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => {
    let msg = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? String(key);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        msg = msg.replaceAll(`{${k}}`, String(v));
      }
    }
    return msg;
  }, [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function dateLocale(locale: Locale): string {
  return locale === "fr" ? "fr-FR" : "en-US";
}
