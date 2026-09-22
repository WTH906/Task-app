import "./globals.css";
import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import { AppShell } from "@/components/AppShell";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fraunces",
  display: "swap",
});

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
    <html lang="en" className={`dark ${dmSans.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){try{var t=localStorage.getItem('comfy-theme');if(t&&t!=='purple'){document.documentElement.setAttribute('data-theme',t);if(t==='frost'||t==='cloud'||t==='dawn'){document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='light'}}}catch(e){}
          try{if(localStorage.getItem('comfy-sidebar-collapsed')==='1'){document.documentElement.style.setProperty('--sidebar-w','0rem');document.documentElement.setAttribute('data-sidebar','collapsed')}}catch(e){}})();
        ` }} />
      </head>
      <body className="bg-bg text-txt font-body min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
