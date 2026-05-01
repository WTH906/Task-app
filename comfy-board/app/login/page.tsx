"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgot, setIsForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

  useEffect(() => { document.title = "Comfy Board — Login"; }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const supabase = createClient();

    if (isForgot) {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset`,
      });
      if (err) {
        setError(err.message);
      } else {
        setMessage("Check your email for a password reset link.");
      }
    } else if (isSignUp) {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
      });
      if (err) {
        setError(err.message);
      } else {
        setMessage("Check your email to confirm your account, then sign in.");
        setIsSignUp(false);
      }
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (err) {
        setError(err.message);
      } else {
        router.replace("/");
        router.refresh();
      }
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="font-title text-3xl text-bright mb-2">Comfy Board</h1>
          <p className="text-txt3 text-sm">Dashboard · Routine · Projects · Planner · Deadlines</p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="text-lg font-medium text-bright mb-4">
            {isForgot ? "Reset password" : isSignUp ? "Create account" : "Sign in"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-txt2 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-txt placeholder-txt3 text-sm"
                placeholder="you@example.com"
              />
            </div>
            {!isForgot && (
              <div>
                <label className="block text-sm text-txt2 mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full bg-surface2 border border-border rounded-lg px-3 py-2.5 text-txt placeholder-txt3 text-sm"
                  placeholder="••••••••"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</p>
            )}
            {message && (
              <p className="text-sm text-green-acc bg-green-acc/10 rounded-lg px-3 py-2">{message}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet hover:bg-violet-dim text-white font-medium rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-50"
            >
              {loading ? "Loading..." : isForgot ? "Send reset link" : isSignUp ? "Sign up" : "Sign in"}
            </button>
          </form>

          <div className="mt-4 text-center space-y-2">
            {!isForgot && !isSignUp && (
              <button
                onClick={() => { setIsForgot(true); setError(""); setMessage(""); }}
                className="block w-full text-sm text-txt3 hover:text-violet2 transition-colors"
              >
                Forgot password?
              </button>
            )}
            <button
              onClick={() => { setIsSignUp(!isSignUp); setIsForgot(false); setError(""); setMessage(""); }}
              className="block w-full text-sm text-txt3 hover:text-violet2 transition-colors"
            >
              {isForgot ? "Back to sign in" : isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
