"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useLocale } from "@/lib/i18n/useLocale";

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgot, setIsForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const { t } = useLocale();

  useEffect(() => { document.title = "Comfy Board — " + t("login.signIn"); }, [t]);

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
        setMessage(t("login.resetSent"));
      }
    } else if (isSignUp) {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
      });
      if (err) {
        setError(err.message);
      } else {
        setMessage(t("login.signUpSuccess"));
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
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-10">
          <h1 className="font-title text-4xl font-semibold text-bright tracking-tight">
            Comfy Board
          </h1>
          <p className="text-txt3 text-sm mt-2">
            {t("login.subtitle")}
          </p>
        </div>

        <div className="glass-panel p-6">
          <h2 className="glass-header text-lg font-medium text-bright pb-4 mb-5">
            {isForgot ? t("login.forgotPassword") : isSignUp ? t("login.signUp") : t("login.signIn")}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm text-txt2 mb-1.5 font-medium">{t("login.email")}</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="glass-field px-3 py-2.5 text-sm"
                placeholder="you@example.com"
              />
            </div>
            {!isForgot && (
              <div>
                <label htmlFor="login-password" className="block text-sm text-txt2 mb-1.5 font-medium">{t("login.password")}</label>
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  className="glass-field px-3 py-2.5 text-sm"
                  placeholder="••••••••"
                />
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-danger-text rounded-lg px-3 py-2"
                style={{ background: "color-mix(in srgb, var(--glass-accent) 8%, transparent)" }}>
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="text-sm text-green-text rounded-lg px-3 py-2"
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
                color: "var(--on-accent)",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--accent2)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "var(--accent)"}
            >
              {loading ? t("common.loading") : isForgot ? t("login.sendResetLink") : isSignUp ? t("login.signUp") : t("login.signIn")}
            </button>
          </form>

          <div className="mt-5 text-center space-y-1.5">
            {!isForgot && !isSignUp && (
              <button
                onClick={() => { setIsForgot(true); setError(""); setMessage(""); }}
                className="block w-full text-sm text-txt3 hover:text-bright transition-colors cursor-pointer"
              >
                {t("login.forgotPassword")}
              </button>
            )}
            <button
              onClick={switchMode}
              className="block w-full text-sm text-txt3 hover:text-bright transition-colors cursor-pointer"
            >
              {isForgot ? t("login.backToSignIn") : isSignUp ? `${t("login.alreadyHaveAccount")} ${t("login.signIn")}` : `${t("login.noAccount")} ${t("login.signUp")}`}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
