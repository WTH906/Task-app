import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
            cookiesToSet.forEach(({ name, value }) => {
              request.cookies.set(name, value);
            });
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) => {
              supabaseResponse.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isLoginPage = request.nextUrl.pathname === "/login";
    const isAuthCallback = request.nextUrl.pathname.startsWith("/auth/");
    const isLanding = request.nextUrl.pathname === "/landing";

    if (!user && !isLoginPage && !isAuthCallback && !isLanding) {
      const url = request.nextUrl.clone();
      url.pathname = "/landing";
      return NextResponse.redirect(url);
    }

    if (user && (isLoginPage || isLanding)) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  } catch {
    const isLoginPage = request.nextUrl.pathname === "/login";
    const isAuthCallback = request.nextUrl.pathname.startsWith("/auth/");
    const isLanding = request.nextUrl.pathname === "/landing";
    if (isLoginPage || isAuthCallback || isLanding) {
      return supabaseResponse;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/landing";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
