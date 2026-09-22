"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <div className="text-4xl mb-4">😵</div>
        <h1 className="font-title text-2xl text-bright mb-2">Something went wrong</h1>
        <p className="text-sm text-txt3 mb-6">
          An unexpected error occurred. Your data is safe — try reloading the page.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-5 py-2.5 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white transition-colors"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.href = "/"}
            className="px-5 py-2.5 rounded-lg text-sm bg-surface border border-border hover:border-border2 text-txt2 transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
        {process.env.NODE_ENV === "development" && (
          <details className="mt-6 text-left">
            <summary className="text-xs text-txt3 cursor-pointer hover:text-txt2">Error details</summary>
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
