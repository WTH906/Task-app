"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { User } from "@supabase/supabase-js";
import { Sidebar } from "./Sidebar";
import { ContactsPanel } from "./ContactsPanel";
import { MonitoringPanel } from "./MonitoringPanel";
import { ToastProvider, useToast } from "./Toast";
import { QuickCapture } from "./QuickCapture";
import { OnboardingModal } from "./OnboardingModal";
import { SettingsProvider } from "@/lib/hooks/useSettings";
import { CurrentUserContext } from "@/lib/hooks/useCurrentUser";

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
  const [contactsOpen, setContactsOpen] = useState(false);
  const [monitoringOpen, setMonitoringOpen] = useState(false);
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

  // Listen for toggle-contacts event from Sidebar
  useEffect(() => {
    const handler = () => setContactsOpen(prev => !prev);
    const monHandler = () => setMonitoringOpen(prev => !prev);
    window.addEventListener("toggle-contacts", handler);
    window.addEventListener("toggle-monitoring", monHandler);
    return () => {
      window.removeEventListener("toggle-contacts", handler);
      window.removeEventListener("toggle-monitoring", monHandler);
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex">
        <div className="w-[15rem] shrink-0 bg-surface/60 border-r border-border/40 p-4 hidden md:flex flex-col gap-3">
          <div className="h-8 w-24 rounded-lg bg-surface2/50 animate-pulse" />
          <div className="mt-4 flex flex-col gap-2">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-9 rounded-lg bg-surface2/30 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6 md:p-8">
          <div className="h-8 w-48 rounded-lg bg-surface2/40 animate-pulse mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="h-32 rounded-xl bg-surface/40 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isLogin || !user) {
    return <ToastProvider><QueryErrorListener />{children}</ToastProvider>;
  }

  return (
    <ToastProvider>
      <CurrentUserContext.Provider value={{ id: user.id, email: user.email || "" }}>
        <SettingsProvider userId={user.id}>
          <QueryErrorListener />
          <div className="min-h-screen">
            <Sidebar user={user} />
            <main className="app-main min-h-screen animate-fade-in">
              {children}
            </main>
            <ContactsPanel open={contactsOpen} onClose={() => setContactsOpen(false)} userId={user.id} />
            <MonitoringPanel open={monitoringOpen} onClose={() => setMonitoringOpen(false)} userId={user.id} />
          </div>
          <QuickCapture userId={user.id} />
          <OnboardingModal userId={user.id} />
        </SettingsProvider>
      </CurrentUserContext.Provider>
    </ToastProvider>
  );
}
