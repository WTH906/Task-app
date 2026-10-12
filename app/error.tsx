"use client";

import { useEffect } from "react";
import { useLocale } from "@/lib/i18n/useLocale";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <div className="text-4xl mb-4">&#x1F635;</div>
        <h1 className="font-title text-2xl text-bright mb-2">{t("error.title")}</h1>
        <p className="text-sm text-txt3 mb-6">
          {t("error.message")}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-5 py-2.5 rounded-lg text-sm bg-violet hover:bg-violet-dim text-on-accent transition-colors"
          >
            {t("error.tryAgain")}
          </button>
          <button
            onClick={() => window.location.href = "/"}
            className="px-5 py-2.5 rounded-lg text-sm bg-surface border border-border hover:border-border2 text-txt2 transition-colors"
          >
            {t("error.goToDashboard")}
          </button>
        </div>
        {process.env.NODE_ENV === "development" && (
          <details className="mt-6 text-left">
            <summary className="text-xs text-txt3 cursor-pointer hover:text-txt2">{t("error.details")}</summary>
            <pre className="mt-2 p-3 bg-surface rounded-lg text-xs text-danger overflow-auto max-h-40">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
