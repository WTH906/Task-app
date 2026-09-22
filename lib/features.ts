/**
 * Feature registry.
 *
 * Comfy Board's design goal is "high-end features, easy to start with". The
 * way those two reconcile is tiering: a new account gets a small, legible
 * surface, and the rest is opted into.
 *
 * So the DEFAULTS here matter more than the toggles do. If everything shipped
 * on and users had to switch things off, nothing would improve — they'd get
 * the overwhelming version plus a settings page.
 *
 * Toggles hide SURFACES, never data. Turning monitoring off leaves every
 * `monitoring` flag intact in the database; the panel just stops rendering,
 * and switching it back on restores exactly what was there.
 */

export type FeatureKey =
  | "dailyRoutine" | "weeklyRoutine" | "monthlyRoutine" | "yearlyRoutine"
  | "planner" | "scheduler" | "projects" | "taskList" | "deadlines"
  | "timers" | "workClock" | "monitoring" | "contacts"
  | "stats" | "roadmap" | "retro"
  | "gcal" | "attachments" | "templates" | "quickCapture"
  | "routineInScheduler";

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  /** One line, written for someone who has never seen the app. */
  blurb: string;
  /** Shown in the picker under this heading. */
  group: "Core" | "Routines" | "Work tracking" | "Extras";
  /** On for a brand-new account. */
  default: boolean;
  /** Core features can't be switched off — the app stops making sense. */
  locked?: boolean;
}

export const FEATURES: FeatureDef[] = [
  // ── Core ────────────────────────────────────────────────────────────────
  { key: "projects", label: "Projects", group: "Core", default: true, locked: true,
    blurb: "Group work into projects with tasks and subtasks." },
  { key: "planner", label: "Planner", group: "Core", default: true, locked: true,
    blurb: "Week and month calendar showing what you've scheduled." },
  { key: "taskList", label: "Task list", group: "Core", default: true, locked: true,
    blurb: "A single inbox for anything that isn't part of a project yet." },
  { key: "quickCapture", label: "Quick capture", group: "Core", default: true,
    blurb: "Press A anywhere to jot something down in two seconds." },
  // Off by default: most tasks only ever need a day, not an hour. This is
  // for the ones that are genuinely time-bound. Switching it off hides the
  // grid but keeps any times already set — turn it back on and they return,
  // which is the rule for every toggle here.
  { key: "scheduler", label: "Hour scheduler", group: "Core", default: false,
    blurb: "Lay a day out by the hour and give a task a precise time slot." },
  { key: "routineInScheduler", label: "Routines in scheduler", group: "Core", default: false,
    blurb: "Auto-populate daily, weekly, monthly and yearly routines into the day grid." },

  // ── Routines ────────────────────────────────────────────────────────────
  { key: "dailyRoutine", label: "Daily routine", group: "Routines", default: true,
    blurb: "Things you do every day. Resets each morning." },
  { key: "weeklyRoutine", label: "Weekly routine", group: "Routines", default: true,
    blurb: "Things you do once a week, optionally pinned to a weekday." },
  { key: "monthlyRoutine", label: "Monthly routine", group: "Routines", default: false,
    blurb: "Once-a-month jobs — invoicing, backups, reviews." },
  { key: "yearlyRoutine", label: "Yearly routine", group: "Routines", default: false,
    blurb: "Annual jobs — insurance, taxes, renewals." },

  // ── Work tracking ───────────────────────────────────────────────────────
  { key: "timers", label: "Task timers", group: "Work tracking", default: true,
    blurb: "Time how long each task actually takes." },
  { key: "deadlines", label: "Deadlines", group: "Work tracking", default: true,
    blurb: "A countdown page for everything with a due date." },
  { key: "stats", label: "Stats", group: "Work tracking", default: true,
    blurb: "Streaks, hours tracked, and how close your estimates were." },
  { key: "workClock", label: "Work clock", group: "Work tracking", default: false,
    blurb: "Clock in and out of your working day, separate from task timers." },
  { key: "monitoring", label: "Monitoring", group: "Work tracking", default: false,
    blurb: "Park tasks you're waiting on someone else for." },

  // ── Extras ──────────────────────────────────────────────────────────────
  { key: "contacts", label: "Contacts", group: "Extras", default: false,
    blurb: "A small address book with tags, kept next to your work." },
  { key: "attachments", label: "File attachments", group: "Extras", default: false,
    blurb: "Attach a file to any task or subtask." },
  { key: "gcal", label: "Google Calendar links", group: "Extras", default: false,
    blurb: "One-click buttons to push a task into Google Calendar." },
  { key: "templates", label: "Project templates", group: "Extras", default: false,
    blurb: "Save a project's task list and reuse it." },
  { key: "roadmap", label: "Roadmap", group: "Extras", default: false,
    blurb: "Phase-by-phase view of a long project." },
  { key: "retro", label: "Retro planning", group: "Extras", default: false,
    blurb: "Work backwards from a deadline to a start date." },
];

export const FEATURE_GROUPS = ["Core", "Routines", "Work tracking", "Extras"] as const;

export type FeatureMap = Record<FeatureKey, boolean>;

export const DEFAULT_FEATURES: FeatureMap = FEATURES.reduce((acc, f) => {
  acc[f.key] = f.default;
  return acc;
}, {} as FeatureMap);

/** Merge stored values over defaults so a new feature key is never undefined. */
export function normalizeFeatures(stored: Partial<FeatureMap> | null | undefined): FeatureMap {
  const out = { ...DEFAULT_FEATURES };
  if (!stored) return out;
  for (const f of FEATURES) {
    if (typeof stored[f.key] === "boolean") out[f.key] = stored[f.key] as boolean;
    if (f.locked) out[f.key] = true;
  }
  return out;
}

export function featureByKey(key: FeatureKey): FeatureDef | undefined {
  return FEATURES.find((f) => f.key === key);
}
