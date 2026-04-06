export function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function progressColor(pct: number): string {
  if (pct <= 20) return "#e05555";
  if (pct <= 40) return "#e88833";
  if (pct <= 60) return "#d4c03a";
  if (pct <= 80) return "#7bc47b";
  return "#2e8b2e";
}

export const DAY_COLORS: Record<number, string> = {
  0: "#f43f5e", // Sun
  1: "#7c6fff", // Mon
  2: "#ec4899", // Tue
  3: "#f59e0b", // Wed
  4: "#4ade80", // Thu
  5: "#38bdf8", // Fri
  6: "#a78bfa", // Sat
};

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function playAlarm() {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 1000;
      gain.gain.value = 0.3;
      osc.start(ctx.currentTime + i * 0.4);
      osc.stop(ctx.currentTime + i * 0.4 + 0.3);
    }
  } catch {
    // Audio not available
  }
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export const PROJECT_COLORS = [
  "#e05555", "#ec4899", "#f59e0b", "#4caf50", "#38bdf8",
  "#7c6fff", "#a78bfa", "#f43f5e", "#14b8a6", "#e88833",
  "#8b5cf6", "#06b6d4", "#84cc16", "#d946ef", "#6366f1",
];

export function getWeekKey(d: Date = new Date()): string {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
