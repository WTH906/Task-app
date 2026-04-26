"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { User } from "@supabase/supabase-js";
import { Sidebar } from "./Sidebar";
import { ToastProvider, useToast } from "./Toast";

function QueryErrorListener() {
  const { toast } = useToast();
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { fn: string; message: string };
      toast(`Failed to load data: ${detail.message}`, "error");
    };
    window.addEventListener("query-error", handler);
    return () => window.removeEventListener("query-error", handler);
  }, [toast]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-violet border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isLogin || !user) {
    return <ToastProvider><QueryErrorListener />{children}</ToastProvider>;
  }

  return (
    <ToastProvider>
      <QueryErrorListener />
      <div className="flex min-h-screen">
        <Sidebar user={user} />
        <main className="flex-1 ml-0 md:ml-60 min-h-screen animate-fade-in">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
