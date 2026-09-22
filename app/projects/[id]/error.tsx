"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ProjectErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Project page error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <div className="text-4xl mb-4">🔧</div>
        <h1 className="font-title text-2xl text-bright mb-2">Project failed to load</h1>
        <p className="text-sm text-txt3 mb-6">
          Something went wrong loading this project. This could be a temporary issue — try again or go back to your projects list.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-5 py-2.5 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white transition-colors"
          >
            Retry
          </button>
          <Link
            href="/projects"
            className="px-5 py-2.5 rounded-lg text-sm bg-surface border border-border hover:border-border2 text-txt2 transition-colors"
          >
            Back to Projects
          </Link>
        </div>
        {process.env.NODE_ENV === "development" && (
          <details className="mt-6 text-left">
            <summary className="text-xs text-txt3 cursor-pointer hover:text-txt2">Error details</summary>
            <pre className="mt-2 p-3 bg-surface rounded-lg text-xs text-danger overflow-auto max-h-40">
              {error.message}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
