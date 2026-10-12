"use client";

import { useEffect } from "react";
import { useLocale } from "@/lib/i18n/useLocale";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: "#0f0e17",
          color: "#fffffe",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "3rem",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>&#x1F635;</div>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            {t("error.fatal")}
          </h1>
          <p style={{ opacity: 0.7, fontSize: "0.875rem", lineHeight: 1.6 }}>
            {t("error.fatalMessage")}
          </p>
          <div
            style={{
              marginTop: "1.5rem",
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
            }}
          >
            <button
              onClick={reset}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "8px",
                border: "none",
                background: "#7c5cbf",
                color: "#fff",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              {t("error.tryAgain")}
            </button>
            <button
              onClick={() => (window.location.href = "/")}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "8px",
                border: "1px solid #2e2f3e",
                background: "#16161f",
                color: "inherit",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              {t("error.goToDashboard")}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
