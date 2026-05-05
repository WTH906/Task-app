import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        surface2: "var(--surface2)",
        surface3: "var(--surface3)",
        border: "var(--border)",
        border2: "var(--border2)",
        txt: "var(--txt)",
        txt2: "var(--txt2)",
        txt3: "var(--txt3)",
        bright: "var(--bright)",
        "red-acc": "#e05555",
        "red-dark": "#b83a3a",
        violet: "var(--accent)",
        violet2: "var(--accent2)",
        "violet-dim": "var(--accent-dim)",
        "green-acc": "#4caf50",
        danger: "#f43f5e",
        amber: "#f59e0b",
        "muted-acc": "var(--muted-acc)",
        "muted-acc2": "var(--muted-acc2)",
      },
      fontFamily: {
        body: ["Inter", "system-ui", "sans-serif"],
        title: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
