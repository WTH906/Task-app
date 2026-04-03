import "./globals.css";
import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Comfy Board",
  description: "Dashboard, Routine, Projects, Weekly Planner & Deadlines",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg text-txt font-body min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
