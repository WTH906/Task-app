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

  const switchMode = () => {
    setIsSignUp(!isSignUp);
    setIsForgot(false);
    setError("");
    setMessage("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-10">
          <h1 className="font-title text-4xl font-semibold text-bright tracking-tight">
            Comfy Board
          </h1>
          <p className="text-txt3 text-sm mt-2">
            Your dashboard, routines, projects, and planner
          </p>
        </div>

        <div className="glass-panel p-6">
          <h2 className="glass-header text-lg font-medium text-bright pb-4 mb-5">
            {isForgot ? "Reset password" : isSignUp ? "Create account" : "Sign in"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-txt2 mb-1.5 font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="glass-field px-3 py-2.5 text-sm"
                placeholder="you@example.com"
              />
            </div>
            {!isForgot && (
              <div>
                <label className="block text-sm text-txt2 mb-1.5 font-medium">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="glass-field px-3 py-2.5 text-sm"
                  placeholder="••••••••"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-danger rounded-lg px-3 py-2"
                style={{ background: "color-mix(in srgb, var(--glass-accent) 8%, transparent)" }}>
                {error}
              </p>
            )}
            {message && (
              <p className="text-sm text-green-acc rounded-lg px-3 py-2"
                style={{ background: "color-mix(in srgb, #4caf50 10%, transparent)" }}>
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full font-medium rounded-xl px-4 py-2.5 text-sm transition-all disabled:opacity-50 cursor-pointer"
              style={{
                background: "var(--accent)",
                color: "var(--bg)",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--accent2)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "var(--accent)"}
            >
              {loading ? "Loading..." : isForgot ? "Send reset link" : isSignUp ? "Sign up" : "Sign in"}
            </button>
          </form>

          <div className="mt-5 text-center space-y-1.5">
            {!isForgot && !isSignUp && (
              <button
                onClick={() => { setIsForgot(true); setError(""); setMessage(""); }}
                className="block w-full text-sm text-txt3 hover:text-bright transition-colors cursor-pointer"
              >
                Forgot password?
              </button>
            )}
            <button
              onClick={switchMode}
              className="block w-full text-sm text-txt3 hover:text-bright transition-colors cursor-pointer"
            >
              {isForgot ? "Back to sign in" : isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
