import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Comfy Board — The task app that adapts to you",
  description:
    "Plan your week, track routines, manage projects, and stay on top of deadlines — all in one app that shows only the features you need.",
  openGraph: {
    title: "Comfy Board",
    description: "The task app that adapts to you",
    url: "https://comfyboard.app",
    siteName: "Comfy Board",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Comfy Board",
    description: "The task app that adapts to you",
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
