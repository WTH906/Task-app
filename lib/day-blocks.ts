import { SupabaseClient } from "@supabase/supabase-js";
import { WeekTask } from "./types";
import { type Block } from "./schedule";
import { syncTaskCompletion, syncSubtaskCompletion, recalcParentFromSubtasks } from "./sync";
import { tryRecurringToggle, type Recurrence } from "./recurrence";
import { announceTaskChanged } from "./task-events";
import { syncRoutineCheck } from "./routine-scheduler";

/**
 * The write operations behind one day's hour grid.
 *
 * These live here rather than in a page because the same grid is now shown in
 * two places — the day page, and the popup on the week view — and this
 * codebase has a long history of the same operation being hand-written per
 * screen and then drifting. Ticking a task in the calendar not checking it in
 * the project tab was exactly that: three copies of one sync, two of which
 * were wrong.
 *
 * Everything here is data only: no React, no optimistic state. Callers own
 * their own UI updates and rollback, because a modal and a full page want
 * different things there.
 */

/**
 * `est_minutes` for the project tasks and subtasks a day's planner rows
 * mirror, keyed by whichever id the row points at.
 *
 * Used ONLY to pre-fill a block's length the first time something is
 * scheduled. Never written back — the estimate is a record of how long the
 * work takes, kept so it can be looked up when planning something similar,
 * and dragging a block around an afternoon must not rewrite it.
 */
export async function fetchDayEstimates(
  supabase: SupabaseClient,
  tasks: WeekTask[]
): Promise<Record<string, number>> {
  const ptIds = [...new Set(
    tasks.filter((t) => t.project_task_id && !t.subtask_id).map((t) => t.project_task_id as string)
  )];
  const subIds = [...new Set(
    tasks.filter((t) => t.subtask_id).map((t) => t.subtask_id as string)
  )];

  const routineTasks = tasks.filter((t) => t.routine_task_id && t.routine_type);
  const routineByType: Record<string, string[]> = {};
  for (const t of routineTasks) {
    const type = t.routine_type!;
    (routineByType[type] ??= []).push(t.routine_task_id!);
  }

  const empty = { data: [] as { id: string; est_minutes: number }[] };
  const [pts, subs, ...routineResults] = await Promise.all([
    ptIds.length ? supabase.from("project_tasks").select("id, est_minutes").in("id", ptIds) : Promise.resolve(empty),
    subIds.length ? supabase.from("subtasks").select("id, est_minutes").in("id", subIds) : Promise.resolve(empty),
    ...(["daily", "weekly", "monthly", "yearly"] as const).map((type) => {
      const ids = routineByType[type];
      if (!ids?.length) return Promise.resolve(empty);
      const table = type === "daily" ? "routine_tasks"
        : type === "weekly" ? "weekly_routine_tasks"
        : type === "monthly" ? "monthly_routine_tasks"
        : "yearly_routine_tasks";
      return supabase.from(table).select("id, est_minutes").in("id", ids);
    }),
  ]);

  const map: Record<string, number> = {};
  for (const r of (pts.data || []) as { id: string; est_minutes: number }[]) map[r.id] = r.est_minutes || 0;
  for (const r of (subs.data || []) as { id: string; est_minutes: number }[]) map[r.id] = r.est_minutes || 0;
  for (const res of routineResults) {
    for (const r of (res.data || []) as { id: string; est_minutes: number }[]) map[r.id] = r.est_minutes || 0;
  }
  return map;
}

/** The estimate for one planner row, or null if it isn't linked to anything. */
export function estimateForTask(
  task: WeekTask,
  estimates: Record<string, number>
): number | null {
  const key = task.subtask_id ?? task.project_task_id ?? task.routine_task_id;
  if (!key) return null;
  return estimates[key] ?? null;
}

/** Give a planner row a time. */
export async function writeBlock(
  supabase: SupabaseClient,
  weekTaskId: string,
  block: Block
): Promise<{ error?: string }> {
  const { error } = await supabase.from("week_tasks")
    .update({ start_minute: block.start, end_minute: block.end })
    .eq("id", weekTaskId);
  return error ? { error: error.message } : {};
}

/**
 * Take a planner row's time away. Both columns move together — the v24 CHECK
 * constraint rejects a half-cleared pair outright.
 */
export async function clearBlockOn(
  supabase: SupabaseClient,
  weekTaskId: string
): Promise<{ error?: string }> {
  const { error } = await supabase.from("week_tasks")
    .update({ start_minute: null, end_minute: null })
    .eq("id", weekTaskId);
  return error ? { error: error.message } : {};
}

/** A task sketched straight onto the grid. Planner-only, like quick capture. */
export async function createPlannerTaskInSlot(
  supabase: SupabaseClient,
  userId: string,
  dateKey: string,
  text: string,
  block: Block,
  sortOrder: number
): Promise<{ row?: WeekTask; error?: string }> {
  const { data, error } = await supabase.from("week_tasks").insert({
    user_id: userId, date_key: dateKey, text,
    sort_order: sortOrder,
    project_id: null, project_task_id: null, subtask_id: null,
    start_minute: block.start, end_minute: block.end,
  }).select().single();

  if (error) return { error: error.message };
  return { row: data as WeekTask };
}

/**
 * Tick or untick a planner row, and carry that through to whatever it mirrors.
 *
 * The caller flips its own UI first and reverts on `error` — this only does
 * the writes. It is the whole cascade in one place:
 *
 *   - repeating tasks record a PERIOD CHECK, never `progress`
 *     (`tryRecurringToggle`, see lib/recurrence.ts)
 *   - subtasks roll their average up to the parent
 *   - a plain task writes progress and syncs its planner mirror + deadline
 *   - an unlinked row that came from quick capture is retired
 *
 * `source` is only used to label the refresh event so the page that made the
 * change doesn't refetch itself.
 */
export async function toggleWeekTaskDone(
  supabase: SupabaseClient,
  userId: string,
  task: WeekTask,
  newDone: boolean,
  source: "planner" | "day" | "dashboard" | "project"
): Promise<{ error?: string; recurrence?: Recurrence; periodKey?: string }> {
  const { error: rowErr } = await supabase.from("week_tasks")
    .update({ done: newDone }).eq("id", task.id);
  if (rowErr) return { error: rowErr.message };

  if (task.routine_task_id && task.routine_type) {
    const res = await syncRoutineCheck(supabase, userId, task.routine_task_id, task.routine_type, task.date_key, newDone);
    if (res.error) return { error: res.error };
    return {};
  }

  if (task.project_task_id) {
    const newProgress = newDone ? 100 : 0;

    const rec = await tryRecurringToggle(supabase, userId, task, newDone);
    if (rec.error) {
      // Put the row back so the calendar doesn't show a tick the project tab
      // knows nothing about.
      await supabase.from("week_tasks").update({ done: !newDone }).eq("id", task.id);
      return { error: rec.error };
    }
    if (rec.handled) {
      announceTaskChanged({ taskId: task.project_task_id, source });
      return { recurrence: rec.recurrence, periodKey: rec.periodKey };
    }

    if (task.subtask_id) {
      const { error } = await supabase.from("subtasks")
        .update({ progress: newProgress }).eq("id", task.subtask_id);
      if (error) return { error: error.message };

      const subSync = await syncSubtaskCompletion(supabase, userId, task.subtask_id, newProgress);
      if (subSync.error) return { error: subSync.error };

      const rollup = await recalcParentFromSubtasks(supabase, userId, task.project_task_id);
      if (rollup.error) return { error: rollup.error };
    } else {
      const { data: subs } = await supabase.from("subtasks")
        .select("id").eq("task_id", task.project_task_id).limit(1);
      if (subs && subs.length > 0) {
        await supabase.from("subtasks")
          .update({ progress: newProgress }).eq("task_id", task.project_task_id);
      }
      const { error } = await supabase.from("project_tasks")
        .update({ progress: newProgress }).eq("id", task.project_task_id);
      if (error) return { error: error.message };

      const sync = await syncTaskCompletion(supabase, userId, task.project_task_id, newProgress);
      if (sync.error) return { error: sync.error };
    }

    announceTaskChanged({ taskId: task.project_task_id, source });
    return {};
  }

  // Not linked to a project: if it came from quick capture, finishing it here
  // retires the quick task too.
  if (newDone) {
    await supabase.from("quick_tasks").delete()
      .eq("user_id", userId).eq("name", task.text).eq("date_key", task.date_key);
  }
  return {};
}
