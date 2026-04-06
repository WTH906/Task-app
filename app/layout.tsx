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
      <head>
        {process.env.NEXT_PUBLIC_DROPBOX_APP_KEY && (
          <script
            type="text/javascript"
            src="https://www.dropbox.com/static/api/2/dropins.js"
            id="dropboxjs"
            data-app-key={process.env.NEXT_PUBLIC_DROPBOX_APP_KEY}
          />
        )}
      </head>
      <body className="bg-bg text-txt font-body min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
