import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requested = searchParams.get("next") ?? "/";

  // Only same-site, single-slash paths. Without this, `?next=@evil.com`
  // produces "https://app.example.com@evil.com" — which the browser parses as
  // host `evil.com` with the app's domain as userinfo, so a link that starts
  // with our own origin drops the user on an attacker's site right after a
  // successful login.
  const next = /^\/(?!\/)/.test(requested) ? requested : "/";

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // If no code or exchange failed, redirect to login
  return NextResponse.redirect(`${origin}/login`);
}
