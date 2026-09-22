import { SupabaseClient } from "@supabase/supabase-js";
import { todayKey, formatDate, addDays } from "./utils";
import {
  isRecurrence, currentPeriodKey, setTaskCheck, reconcileRecurringMirror,
} from "./recurrence";

/**
 * How far ahead recurring occurrences are materialised into week_tasks,
 * measured in days from *today* (not from the task's start date).
 *
 * Rows are topped up by `extendRecurringWeekTasks()` on planner load, so a
 * daily task keeps rolling forward instead of dying at the end of its
 * originally-generated window.
 */
export const RECURRENCE_HORIZON_DAYS: Record<string, number> = {
  daily: 90,
  weekly: 365,
  monthly: 730,
  yearly: 1825,
};

/** Hard cap on rows generated for a single task, as a runaway guard. */
const MAX_OCCURRENCES = 400;

/**
 * Expand a recurrence rule into concrete YYYY-MM-DD date keys.
 *
 * Always uses T12:00:00 (noon) + local date getters so DST and UTC+ timezones
 * can't shift an occurrence onto the neighbouring day.
 * Month/year steps clamp to the last day of the target month
 * (Jan 31 + 1mo = Feb 28, not Mar 3).
 */
export function generateRecurrenceDates(
  startDate: string,
  recurrence: string | null | undefined,
  options?: { from?: string; horizonEnd?: string }
): string[] {
  if (!startDate) return [];
  if (!recurrence) return [startDate];

  const span = RECURRENCE_HORIZON_DAYS[recurrence];
  if (!span) return [startDate];

  const todayStr = todayKey();

  // Horizon is anchored on today so repeated syncs keep extending forward,
  // but never ends before the task's own start date.
  const end = options?.horizonEnd ?? formatDate(addDays(new Date(), span));
  const limit = end < startDate ? startDate : end;

  // Lower bound. Occurrences that are already well in the past are of no use
  // to the planner, and materialising them would (a) back-fill years of dead
  // rows and (b) burn the MAX_OCCURRENCES budget before ever reaching today —
  // which is how a long-running daily task used to disappear entirely.
  const floor = options?.from ?? formatDate(addDays(new Date(), -7));
  const lower = startDate > floor ? startDate : floor;

  const base = new Date(startDate + "T12:00:00");
  if (isNaN(base.getTime())) return [startDate];
  const baseDay = base.getDate();

  // Jump straight to the first occurrence at or after `lower` instead of
  // stepping there one interval at a time.
  let startIndex = 0;
  if (lower > startDate) {
    const dayGap = Math.floor(
      (new Date(lower + "T12:00:00").getTime() - base.getTime()) / 86400000
    );
    if (recurrence === "daily") {
      startIndex = Math.max(0, dayGap);
    } else if (recurrence === "weekly") {
      startIndex = Math.max(0, Math.floor(dayGap / 7));
    } else if (recurrence === "monthly") {
      const lo = new Date(lower + "T12:00:00");
      startIndex = Math.max(0,
        (lo.getFullYear() - base.getFullYear()) * 12 + (lo.getMonth() - base.getMonth()) - 1);
    } else if (recurrence === "yearly") {
      startIndex = Math.max(0,
        new Date(lower + "T12:00:00").getFullYear() - base.getFullYear() - 1);
    }
  }

  const dates: string[] = [];
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const i = startIndex + n;
    const d = new Date(base);
    if (i > 0) {
      if (recurrence === "daily") {
        d.setDate(d.getDate() + i);
      } else if (recurrence === "weekly") {
        d.setDate(d.getDate() + i * 7);
      } else if (recurrence === "monthly") {
        d.setDate(1);
        d.setMonth(base.getMonth() + i);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(baseDay, lastDay));
      } else if (recurrence === "yearly") {
        d.setDate(1);
        d.setFullYear(base.getFullYear() + i);
        d.setMonth(base.getMonth());
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(baseDay, lastDay));
      } else {
        break;
      }
    }
    const key = formatDate(d);
    if (key > limit) break;
    if (key < lower) continue;
    dates.push(key);
  }

  // A series whose entire window is in the past still deserves its anchor row.
  if (dates.length === 0) return startDate >= todayStr ? [startDate] : [];
  return dates;
}

/**
 * Sync a project task to the weekly planner.
 * Delete-then-insert pattern — handles duplicates and recurrence.
 *
 * Completion state is preserved across the rebuild: a day the user had already
 * ticked off stays ticked after an unrelated edit (e.g. changing est_minutes).
 */
export async function syncProjectTaskToWeek(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  taskName: string,
  projectId: string,
  projectTitle: string,
  calendarDate: string | null,
  oldDate?: string | null,
  recurrence?: string | null
): Promise<{ error?: string }> {
  try {
    // Only touch main-task week_tasks (subtask_id IS NULL)
    if (!calendarDate) {
      await supabase.from("week_tasks").delete()
        .eq("project_task_id", taskId).eq("user_id", userId).is("subtask_id", null);
      return {};
    }

    // The project is carried by project_id and rendered as a coloured border.
    // It used to be baked into this string as a "[Project] " prefix, which ate
    // ~40% of the line width in the planner and became a second, drifting
    // source of truth for which project a task belonged to.
    const text = taskName;

    // Snapshot the existing rows so everything the user put on them survives
    // the rebuild — this function DELETES and re-INSERTS, so anything not
    // captured here is destroyed by an unrelated edit.
    //
    // The time block (migration v24) is in this list for exactly that reason:
    // without it, renaming a task on the project page silently wiped the hour
    // you had scheduled it at.
    const { data: existing } = await supabase.from("week_tasks")
      .select("date_key, done, sort_order, rescheduled_to, start_minute, end_minute")
      .eq("project_task_id", taskId).eq("user_id", userId).is("subtask_id", null);

    const prior = new Map<string, {
      done: boolean; sort_order: number; rescheduled_to: string | null;
      start_minute: number | null; end_minute: number | null;
    }>();
    for (const row of existing || []) {
      prior.set(row.date_key, {
        done: !!row.done,
        sort_order: row.sort_order ?? 999,
        rescheduled_to: row.rescheduled_to ?? null,
        start_minute: row.start_minute ?? null,
        end_minute: row.end_minute ?? null,
      });
    }

    const dates = generateRecurrenceDates(calendarDate, recurrence);

    // Rebuild only the forward window. For a recurring task the generated set
    // starts near today, so wiping every row would silently erase months of
    // completed history; past occurrences are left untouched.
    const del = supabase.from("week_tasks").delete()
      .eq("project_task_id", taskId).eq("user_id", userId).is("subtask_id", null);
    if (recurrence && dates.length > 0) {
      await del.gte("date_key", dates[0]);
    } else {
      await del;
    }

    const inserts = dates.map((dk, i) => {
      const before = prior.get(dk);
      return {
        user_id: userId,
        date_key: dk,
        text,
        done: before?.done ?? false,
        project_id: projectId,
        project_task_id: taskId,
        sort_order: before?.sort_order ?? 999 + i,
        rescheduled_to: before?.rescheduled_to ?? null,
        // Both columns move together or the v24 CHECK rejects the insert.
        start_minute: before?.start_minute ?? null,
        end_minute: before?.end_minute ?? null,
      };
    });

    const { error } = await supabase.from("week_tasks").insert(inserts);
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Top up recurring tasks so their planner rows keep rolling forward.
 *
 * Without this, a daily task only ever has the occurrences generated at save
 * time and simply stops once they run out. Called on planner load; issues
 * three queries total regardless of how many recurring tasks exist.
 */
let extendInFlight: Promise<{ error?: string; added?: number }> | null = null;

export async function extendRecurringWeekTasks(
  supabase: SupabaseClient,
  userId: string
): Promise<{ error?: string; added?: number }> {
  // Read-then-insert with no unique constraint to fall back on: two concurrent
  // runs would each compute the same "missing" set and both insert it.
  // React StrictMode double-invokes mount effects in dev, and the user can
  // have the planner open in two tabs, so both are realistic.
  if (extendInFlight) return extendInFlight;
  extendInFlight = runExtendRecurringWeekTasks(supabase, userId)
    .finally(() => { extendInFlight = null; });
  return extendInFlight;
}

async function runExtendRecurringWeekTasks(
  supabase: SupabaseClient,
  userId: string
): Promise<{ error?: string; added?: number }> {
  try {
    const { data: tasks, error: taskErr } = await supabase
      .from("project_tasks")
      .select("id, name, project_id, date_key, recurrence")
      .eq("user_id", userId)
      .not("recurrence", "is", null)
      .not("date_key", "is", null)
      .is("archived_at", null);
    // NOTE: no `.lt("progress", 100)` filter.
    //
    // It used to be here, on the reasoning that a finished task needs no more
    // occurrences. That reasoning does not hold for a repeating task under the
    // per-period model: `progress` is no longer its completion state (see
    // migration v23), and anything that still wrote 100 onto a recurring row —
    // a subtask roll-up, an import, a pre-v23 record — would silently stop the
    // series being topped up. The task would then run out of materialised
    // occurrences and disappear from the planner permanently, with no control
    // left in the UI to bring it back.

    if (taskErr) return { error: taskErr.message };
    if (!tasks || tasks.length === 0) return { added: 0 };

    const ids = tasks.map((t: { id: string }) => t.id);

    const { data: rows, error: rowErr } = await supabase
      .from("week_tasks")
      .select("project_task_id, date_key")
      .eq("user_id", userId)
      .is("subtask_id", null)
      .in("project_task_id", ids);

    if (rowErr) return { error: rowErr.message };

    // Existing occurrence set per task, plus the furthest date already
    // materialised. Only dates *beyond* that watermark are added, so an
    // occurrence the user deliberately deleted mid-series is not resurrected
    // on the next planner load.
    const seen = new Map<string, Set<string>>();
    const watermark = new Map<string, string>();
    for (const r of rows || []) {
      const key = r.project_task_id as string;
      const dk = r.date_key as string;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(dk);
      const current = watermark.get(key);
      if (!current || dk > current) watermark.set(key, dk);
    }

    type RecurringTask = {
      id: string; name: string; project_id: string;
      date_key: string; recurrence: string;
    };

    const inserts: Record<string, unknown>[] = [];
    const touched: RecurringTask[] = [];
    for (const t of tasks as RecurringTask[]) {
      // Planner rows store the bare task name; the project is resolved through
      // project_id at render time (migration v21).
      const text = t.name;
      const have = seen.get(t.id) ?? new Set<string>();
      const last = watermark.get(t.id);

      const wanted = generateRecurrenceDates(t.date_key, t.recurrence);
      const before = inserts.length;
      for (const dk of wanted) {
        if (have.has(dk)) continue;
        // Never fill gaps behind the watermark — those are deletions, not
        // missing occurrences.
        if (last && dk <= last) continue;
        inserts.push({
          user_id: userId, date_key: dk, text, done: false,
          project_id: t.project_id, project_task_id: t.id, sort_order: 999,
        });
      }
      if (inserts.length > before) touched.push(t);
    }

    if (inserts.length === 0) return { added: 0 };

    const { error } = await supabase.from("week_tasks").insert(inserts);
    if (error) return { error: error.message };

    // New rows go in with `done = false`. That is right for a future period,
    // but wrong if a top-up lands an occurrence inside a period that is
    // already checked — the calendar would then contradict the project tab.
    // Only tasks that actually gained rows are reconciled.
    for (const t of touched) {
      if (!isRecurrence(t.recurrence)) continue;
      const res = await reconcileRecurringMirror(supabase, userId, t.id, t.recurrence);
      if (res.error) console.error("[recurrence:reconcile]", t.id, res.error);
    }

    return { added: inserts.length };
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Sync a subtask to the weekly planner via subtask_id FK.
 * Delete-then-insert — no maybeSingle.
 */
export async function syncSubtaskToWeek(
  supabase: SupabaseClient,
  userId: string,
  subtaskId: string,
  parentTaskId: string,
  subtaskName: string,
  projectId: string,
  projectTitle: string,
  calendarDate: string | null,
): Promise<{ error?: string }> {
  try {
    // Preserve what the user put on the row across the rebuild. This function
    // deletes and re-inserts, so anything not captured here is destroyed by an
    // unrelated edit — renaming the subtask, or changing its estimate.
    const { data: existing } = await supabase.from("week_tasks")
      .select("date_key, done, start_minute, end_minute")
      .eq("subtask_id", subtaskId).eq("user_id", userId);

    type PriorRow = { date_key: string; done: boolean; start_minute: number | null; end_minute: number | null };
    const sameDay = (existing || []).find((r: PriorRow) => r.date_key === calendarDate);
    const wasDone = !!sameDay?.done;
    // The time block only carries over when the row stays on the same day —
    // moving a subtask to a different date is a new placement, and inheriting
    // yesterday's 09:00 there would be a guess rather than a memory.
    const priorStart = sameDay?.start_minute ?? null;
    const priorEnd = sameDay?.end_minute ?? null;

    // Always delete existing entries for this subtask first
    await supabase.from("week_tasks").delete()
      .eq("subtask_id", subtaskId).eq("user_id", userId);

    if (!calendarDate) return {};

    // "↳" is derived from subtask_id at render time, not stored in the text.
    const text = subtaskName;

    const { data: maxOrder } = await supabase
      .from("week_tasks").select("sort_order")
      .eq("user_id", userId).eq("date_key", calendarDate)
      .order("sort_order", { ascending: false }).limit(1).maybeSingle();

    const { error } = await supabase.from("week_tasks").insert({
      user_id: userId, date_key: calendarDate, text, done: wasDone,
      project_id: projectId, project_task_id: parentTaskId,
      subtask_id: subtaskId, sort_order: (maxOrder?.sort_order ?? -1) + 1,
      // Both or neither — the v24 CHECK rejects a half-set pair.
      start_minute: priorStart, end_minute: priorEnd,
    });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Rename a subtask everywhere it is mirrored (planner rows + deadline label).
 */
export async function syncSubtaskRename(
  supabase: SupabaseClient,
  userId: string,
  subtaskId: string,
  projectTitle: string,
  newName: string,
  oldName: string
): Promise<{ error?: string }> {
  try {
    // Planner rows store the bare name; deadline labels keep the "[Project] ↳"
    // prefix because that page is full-width and the label is also what gets
    // exported to Google Calendar.
    const oldLabel = `[${projectTitle}] ↳ ${oldName}`;
    const newLabel = `[${projectTitle}] ↳ ${newName}`;
    await supabase.from("week_tasks").update({ text: newName })
      .eq("subtask_id", subtaskId).eq("user_id", userId);
    await supabase.from("deadlines").update({ label: newLabel })
      .eq("user_id", userId).eq("label", oldLabel);
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Remove all week_tasks linked to a project task.
 * `includeSubtasks` is false when only the main-task rows should go, so a
 * subtask that has since been moved to another parent isn't collateral damage.
 */
export async function removeWeekTasksForProjectTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string
): Promise<{ error?: string }> {
  try {
    const { error } = await supabase.from("week_tasks").delete()
      .eq("project_task_id", taskId).eq("user_id", userId);
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Remove every trace of a project task from the mirrored tables.
 * Used on delete and archive so nothing is orphaned in the planner or on the
 * deadlines page.
 */
export async function removeTaskMirrors(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  subtaskId?: string
): Promise<{ error?: string }> {
  try {
    if (subtaskId) {
      const [week, dl] = await Promise.all([
        supabase.from("week_tasks").delete().eq("subtask_id", subtaskId).eq("user_id", userId),
        supabase.from("deadlines").delete().eq("source_subtask_id", subtaskId).eq("user_id", userId),
      ]);
      const error = week.error || dl.error;
      if (error) return { error: error.message };
      return {};
    }
    const [week, dl] = await Promise.all([
      supabase.from("week_tasks").delete().eq("project_task_id", taskId).eq("user_id", userId),
      supabase.from("deadlines").delete().eq("source_task_id", taskId).eq("user_id", userId),
    ]);
    const error = week.error || dl.error;
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Sync a task's deadline to the deadlines table.
 * Delete-then-insert — no maybeSingle.
 */
export async function syncTaskDeadlineToDeadlines(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  taskName: string,
  projectTitle: string,
  deadline: string | null,
  recurrence?: string | null
): Promise<{ error?: string }> {
  try {
    const label = `[${projectTitle}] ${taskName}`;

    // Always delete existing deadlines for this task first
    await supabase.from("deadlines").delete()
      .eq("source_task_id", taskId).eq("user_id", userId);

    if (!deadline) return {};

    const { error } = await supabase.from("deadlines").insert({
      user_id: userId, label,
      target_datetime: deadlineTimestamp(deadline),
      source_task_id: taskId,
      ...(recurrence ? { recurrence } : {}),
    });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Build an end-of-day timestamp for a YYYY-MM-DD deadline, carrying the
 * browser's UTC offset so the DB (TIMESTAMPTZ, stored as UTC) resolves it to
 * 23:59 *local* rather than 23:59 UTC.
 */
export function deadlineTimestamp(dateKey: string): string {
  const local = new Date(`${dateKey}T23:59:00`);
  if (isNaN(local.getTime())) return `${dateKey}T23:59:00`;
  const offsetMin = -local.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${dateKey}T23:59:00${sign}${hh}:${mm}`;
}

/**
 * Sync task completion to calendar.
 * Only marks today's and past entries as done (preserves future recurring entries).
 *
 * Un-completing restores the deadline row that completion removed, so a
 * mis-click is no longer destructive.
 */
export async function syncTaskCompletion(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  progress: number
): Promise<{ error?: string }> {
  try {
    const isDone = progress >= 100;
    const today = todayKey();

    // ── Repeating tasks opt out entirely ──────────────────────────────
    //
    // Everything below treats `progress` as the task's completion, which is
    // exactly what the per-period model replaced (migration v23). Left
    // unguarded this function is destructive on a repeating task from either
    // direction:
    //
    //   done   → marks EVERY occurrence up to today as done and deletes the
    //            deadline, without recording a single period check
    //   undone → clears `done` on every occurrence ever, with no date bound,
    //            wiping months of completed weeks while the checks still say
    //            they were done
    //
    // It is reachable without anyone ticking the task directly: rolling up
    // subtasks, deleting the last incomplete subtask, or moving a subtask away
    // all recompute the parent's average and land here.
    //
    // Completion for these tasks goes through setTaskCheck in
    // lib/recurrence.ts, which is the only thing that may write their `done`
    // mirror.
    const { data: recRow, error: recErr } = await supabase
      .from("project_tasks").select("recurrence").eq("id", taskId).maybeSingle();
    if (recErr) return { error: recErr.message };
    if (recRow?.recurrence) return {};

    if (isDone) {
      // Only mark today's and past calendar entries as done
      const { error } = await supabase.from("week_tasks").update({ done: true })
        .eq("project_task_id", taskId).eq("user_id", userId)
        .is("subtask_id", null).lte("date_key", today);
      if (error) return { error: error.message };

      // Remove the deadline (restored on un-complete)
      await supabase.from("deadlines").delete()
        .eq("source_task_id", taskId).eq("user_id", userId);
    } else {
      // Uncompleting — reset all linked week_tasks
      const { error } = await supabase.from("week_tasks").update({ done: false })
        .eq("project_task_id", taskId).eq("user_id", userId)
        .is("subtask_id", null);
      if (error) return { error: error.message };

      // Restore the deadline row if the task still has one on file.
      // Errors are surfaced rather than swallowed: before migration v18 the
      // `recurrence` column doesn't exist, which fails the whole select and
      // would otherwise make this branch a silent no-op.
      const { data: task, error: readErr } = await supabase.from("project_tasks")
        .select("name, deadline, recurrence, projects(title)")
        .eq("id", taskId).eq("user_id", userId).maybeSingle();

      if (readErr) return { error: readErr.message };

      if (task?.deadline) {
        const rel = task.projects as { title: string } | { title: string }[] | null;
        const projectTitle = (Array.isArray(rel) ? rel[0] : rel)?.title ?? "";
        const { data: already } = await supabase.from("deadlines")
          .select("id").eq("source_task_id", taskId).eq("user_id", userId).limit(1);
        if (!already || already.length === 0) {
          await supabase.from("deadlines").insert({
            user_id: userId,
            label: `[${projectTitle}] ${task.name}`,
            target_datetime: deadlineTimestamp(task.deadline as string),
            source_task_id: taskId,
            ...(task.recurrence ? { recurrence: task.recurrence } : {}),
          });
        }
      }
    }
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Sync subtask completion to linked week_tasks.
 */
export async function syncSubtaskCompletion(
  supabase: SupabaseClient,
  userId: string,
  subtaskId: string,
  progress: number
): Promise<{ error?: string }> {
  try {
    const isDone = progress >= 100;
    const { error } = await supabase.from("week_tasks").update({ done: isDone })
      .eq("subtask_id", subtaskId).eq("user_id", userId);
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Recalculate a parent task's progress from its subtasks and persist it,
 * then mirror the result into the planner + deadlines.
 *
 * This is the single place that "checking a subtask rolls up to its parent"
 * is implemented, so the project page and the planner can't drift apart.
 */
export async function recalcParentFromSubtasks(
  supabase: SupabaseClient,
  userId: string,
  parentTaskId: string
): Promise<{ error?: string; progress?: number }> {
  try {
    const { data: subs, error } = await supabase
      .from("subtasks").select("progress").eq("task_id", parentTaskId);
    if (error) return { error: error.message };
    if (!subs || subs.length === 0) return {};

    const avg = Math.round(
      subs.reduce((s: number, st: { progress: number }) => s + (st.progress || 0), 0) / subs.length
    );

    const { data: parent, error: parentErr } = await supabase
      .from("project_tasks").select("recurrence").eq("id", parentTaskId).maybeSingle();
    if (parentErr) return { error: parentErr.message };
    const recurrence = parent?.recurrence as string | null | undefined;

    // A repeating parent rolls its subtasks up into THIS PERIOD's check, not
    // into `progress`. Finishing every subtask of "Weekly invoicing" means the
    // week is done — not that the task is done forever — and un-finishing one
    // reopens the same week rather than erasing every week before it.
    if (isRecurrence(recurrence)) {
      const period = currentPeriodKey(recurrence);
      const res = await setTaskCheck(
        supabase, userId, parentTaskId, recurrence, period, avg >= 100
      );
      if (res.error) return { error: res.error };
      return { progress: avg };
    }

    const { error: upErr } = await supabase
      .from("project_tasks").update({ progress: avg }).eq("id", parentTaskId);
    if (upErr) return { error: upErr.message };

    await syncTaskCompletion(supabase, userId, parentTaskId, avg);
    return { progress: avg };
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Move a planner entry to another day, keeping the old one as a record.
 *
 * The old row is not deleted — it stays on its original day marked
 * `rescheduled_to`, greyed out. That is deliberate and is one of the things
 * this app does that a normal calendar doesn't: the stats can then show that
 * you moved a task rather than quietly pretending it was always on Thursday.
 *
 * Lives here, not in a page component, because it used to be reachable only
 * from one modal on the week page — deleting that modal would have deleted
 * the feature with it.
 */
export async function rescheduleWeekTask(
  supabase: SupabaseClient,
  userId: string,
  task: {
    id: string; date_key: string; text: string;
    project_id: string | null; project_task_id: string | null; subtask_id: string | null;
    start_minute?: number | null; end_minute?: number | null;
  },
  newDate: string
): Promise<{ inserted?: Record<string, unknown>; error?: string }> {
  if (!userId || !newDate || newDate === task.date_key) return {};

  try {
    // Mark the old entry and find the target day's tail position. Independent
    // of each other, so issued together.
    const [markRes, orderRes] = await Promise.all([
      supabase.from("week_tasks").update({ rescheduled_to: newDate }).eq("id", task.id),
      supabase.from("week_tasks").select("sort_order")
        .eq("user_id", userId).eq("date_key", newDate)
        .order("sort_order", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (markRes.error) return { error: markRes.error.message };

    const { data: inserted, error: insErr } = await supabase.from("week_tasks").insert({
      user_id: userId, date_key: newDate, text: task.text,
      done: false, project_id: task.project_id,
      project_task_id: task.project_task_id, subtask_id: task.subtask_id,
      sort_order: (orderRes.data?.sort_order ?? -1) + 1,
      // The time block travels with the task. Moving "the 14:00 call" to
      // Tuesday means it is still at 14:00; dropping it here would silently
      // unschedule the task and leave the ghost row holding the only copy.
      start_minute: task.start_minute ?? null,
      end_minute: task.end_minute ?? null,
    }).select().single();

    if (insErr) {
      // Undo the marker, or the task ends up greyed out on the old day with
      // no replacement anywhere.
      await supabase.from("week_tasks").update({ rescheduled_to: null }).eq("id", task.id);
      return { error: insErr.message };
    }

    // Move the linked project task's own date too — but NOT for a recurring
    // one. `date_key` is the recurrence anchor there, so re-pointing it would
    // move every future occurrence as well: push one monthly occurrence from
    // the 15th to the 18th and the whole series follows.
    const table = task.subtask_id ? "subtasks" : "project_tasks";
    const linkedId = task.subtask_id ?? task.project_task_id;
    if (linkedId) {
      let isRecurring = false;
      if (!task.subtask_id && task.project_task_id) {
        const { data: pt } = await supabase.from("project_tasks")
          .select("recurrence").eq("id", task.project_task_id).maybeSingle();
        isRecurring = !!pt?.recurrence;
      }
      if (!isRecurring) {
        const { error } = await supabase.from(table)
          .update({ date_key: newDate }).eq("id", linkedId);
        if (error) console.error("[week:reschedule-link]", error.message);
      }
    }

    return { inserted: inserted as Record<string, unknown> };
  } catch (e) {
    return { error: String(e) };
  }
}
