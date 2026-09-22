/**
 * Cross-page notification that a project task changed somewhere else.
 *
 * ── Why this exists ────────────────────────────────────────────────────
 *
 * The project page fetches its tasks once, on mount. Nothing tells it to
 * look again. So ticking a task in the calendar wrote the change correctly
 * and the project tab — if it was already open — carried on showing the old
 * value until it was reloaded by hand.
 *
 * That is the residue of the long-standing "checking in the calendar doesn't
 * check it in the project tab" report. The write half was a lazy thenable
 * that never fired, fixed in the audit; the read half is this, and it is
 * why the symptom stayed *intermittent* afterwards — it only shows up when
 * the project page happened to be mounted already.
 *
 * The app already uses window events for exactly this (`projects-changed`,
 * `task-moved`), so this follows the same pattern rather than inventing a
 * store. It only reaches other components in the SAME tab; a second browser
 * tab still needs a reload, which is a much rarer case and would need
 * Supabase realtime to solve properly.
 */

export const TASK_CHANGED_EVENT = "project-task-changed";

export interface TaskChangedDetail {
  /** The project_tasks row that changed, when known. */
  taskId?: string | null;
  /** Where the change came from, for debugging. */
  source: "planner" | "day" | "dashboard" | "project";
}

/** Announce that a project task changed. Safe to call during SSR. */
export function announceTaskChanged(detail: TaskChangedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TASK_CHANGED_EVENT, { detail }));
}

/** Subscribe. Returns the unsubscribe function, for a useEffect cleanup. */
export function onTaskChanged(handler: (detail: TaskChangedDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent).detail as TaskChangedDetail);
  window.addEventListener(TASK_CHANGED_EVENT, listener);
  return () => window.removeEventListener(TASK_CHANGED_EVENT, listener);
}
