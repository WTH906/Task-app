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
        bg: "#0c0a18",
        surface: "#12121a",
        surface2: "#1a1a26",
        surface3: "#22223a",
        border: "#2a2a40",
        border2: "#3a3a55",
        txt: "#e8e6ff",
        txt2: "#9896b8",
        txt3: "#7b79a0",
        bright: "#f0eeff",
        "red-acc": "#e05555",
        "red-dark": "#b83a3a",
        violet: "#7c6fff",
        violet2: "#a594ff",
        "violet-dim": "#534ab7",
        "green-acc": "#4caf50",
        danger: "#f43f5e",
        amber: "#f59e0b",
        "muted-acc": "#5b6a8a",
        "muted-acc2": "#7889a8",
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
