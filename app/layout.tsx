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
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){try{var t=localStorage.getItem('comfy-theme');if(t&&t!=='purple')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();
        ` }} />
      </head>
      <body className="bg-bg text-txt font-body min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
