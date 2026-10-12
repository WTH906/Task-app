"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => { document.title = "Comfy Board — Reset Password"; }, []);

  // Supabase detects the hash fragment and establishes session automatically
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    // Also check if already in recovery state (hash already processed)
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setReady(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.updateUser({ password });

    if (err) {
      setError(err.message);
    } else {
      setMessage("Password updated! Redirecting...");
      setTimeout(() => router.replace("/"), 1500);
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-title text-3xl text-bright mb-2">Comfy Board</h1>
          <p className="text-txt3 text-sm">Set your new password</p>
        </div>

        <div className="bg-surface border border-border rounded-xl p-6">
          {!ready ? (
            <div className="text-center py-4">
              <div className="w-6 h-6 border-2 border-violet border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-txt3">Verifying reset link...</p>
              <p className="text-xs text-txt3 mt-2">If this takes too long, the link may have expired. <a href="/login" className="text-violet2 hover:underline">Request a new one</a></p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="reset-password" className="block text-sm text-txt2 mb-1.5">New password</label>
                <input
                  id="reset-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="w-full bg-surface2 border border-ctl rounded-lg px-3 py-2.5 text-txt placeholder-txt3 text-sm"
                  placeholder="••••••••"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="reset-confirm" className="block text-sm text-txt2 mb-1.5">Confirm password</label>
                <input
                  id="reset-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="w-full bg-surface2 border border-ctl rounded-lg px-3 py-2.5 text-txt placeholder-txt3 text-sm"
                  placeholder="••••••••"
                />
              </div>

              {error && <p role="alert" className="text-sm text-danger-text bg-danger/10 rounded-lg px-3 py-2">{error}</p>}
              {message && <p role="status" className="text-sm text-green-text bg-green-acc/10 rounded-lg px-3 py-2">{message}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-violet hover:bg-violet-dim text-on-accent font-medium rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-50"
              >
                {loading ? "Updating..." : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
