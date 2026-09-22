import { SupabaseClient } from "@supabase/supabase-js";
import { formatDate, getWeekKey, getMonthKey } from "./utils";

/**
 * Per-period completion for recurring project tasks.
 *
 * ── The problem this solves ────────────────────────────────────────────
 *
 * A recurring task used to have a single `progress` value. Tick "Weekly
 * invoicing" once and it reads 100% forever — there was no way to express
 * "done this week, not yet done next week", which is the entire point of a
 * repeating task. It also meant a recurring task was permanently counted as
 * finished by every stats query.
 *
 * Completion now lives per period, exactly like the routine tables
 * (routine_checks, weekly_routine_checks, …). One row per completion in
 * `project_task_checks`; nothing to reset, nothing to expire. When the
 * period rolls over the task is simply unchecked again — that is the
 * "refresh".
 *
 * ── Division of labour with week_tasks ─────────────────────────────────
 *
 *   project_task_checks  — WAS THIS PERIOD DONE.  Canonical.
 *   week_tasks           — WHERE DOES IT APPEAR in the planner. Scheduling
 *                          only; its `done` flag is a cached mirror.
 *
 * Both are written by `setTaskCheck` below and by nothing else, so they
 * cannot drift the way the old hand-synced call sites did.
 */

export type Recurrence = "daily" | "weekly" | "monthly" | "yearly";

export const RECURRENCES: Recurrence[] = ["daily", "weekly", "monthly", "yearly"];

export function isRecurrence(v: string | null | undefined): v is Recurrence {
  return v === "daily" || v === "weekly" || v === "monthly" || v === "yearly";
}

/** Human label for the repeat badge on a task row. */
export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

/** What the current period is called, for "done today" / "done this week". */
export const PERIOD_NOUN: Record<Recurrence, string> = {
  daily: "today",
  weekly: "this week",
  monthly: "this month",
  yearly: "this year",
};

// ─── Period keys ────────────────────────────────────────────────────────
//
// Same shapes the routine tables already use, so a reader who knows one
// knows the other:
//   daily    2026-08-19
//   weekly   2026-W34
//   monthly  2026-08
//   yearly   2026
//
// All derived from LOCAL date parts. `toISOString()` is never used here: it
// converts to UTC first, which silently shifts the key by a day for anyone
// east of Greenwich after their evening.

/** Parse a `YYYY-MM-DD` key into a local-midnight Date. */
export function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** The period key a given calendar date falls into, for this recurrence. */
export function periodKeyForDate(recurrence: Recurrence, date: Date): string {
  switch (recurrence) {
    case "daily":
      return formatDate(date);
    case "weekly":
      return getWeekKey(date);
    case "monthly":
      return getMonthKey(date);
    case "yearly":
      return String(date.getFullYear());
  }
}

/** Same, from a `YYYY-MM-DD` string (a week_tasks.date_key). */
export function periodKeyForDateKey(recurrence: Recurrence, dateKey: string): string {
  return periodKeyForDate(recurrence, parseDateKey(dateKey));
}

/** The period we are in right now. */
export function currentPeriodKey(recurrence: Recurrence, now: Date = new Date()): string {
  return periodKeyForDate(recurrence, now);
}

/**
 * Step a date back by exactly one period. Used to walk streaks backwards
 * without having to parse the key format back into a date.
 */
function stepBack(recurrence: Recurrence, d: Date): Date {
  const n = new Date(d);
  switch (recurrence) {
    case "daily":
      n.setDate(n.getDate() - 1);
      break;
    case "weekly":
      n.setDate(n.getDate() - 7);
      break;
    case "monthly":
      // Anchor to the 1st first. Stepping back from the 31st would otherwise
      // skip a month entirely (31 March − 1 month = 3 March in JS).
      n.setDate(1);
      n.setMonth(n.getMonth() - 1);
      break;
    case "yearly":
      n.setDate(1);
      n.setMonth(0);
      n.setFullYear(n.getFullYear() - 1);
      break;
  }
  return n;
}

/**
 * The inclusive calendar range a period covers, as `YYYY-MM-DD` keys.
 * Used to mirror a check onto every planner row inside that period.
 */
export function periodRange(
  recurrence: Recurrence,
  periodKey: string
): { start: string; end: string } | null {
  switch (recurrence) {
    case "daily": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return null;
      return { start: periodKey, end: periodKey };
    }
    case "weekly": {
      const m = /^(\d{4})-W(\d{2})$/.exec(periodKey);
      if (!m) return null;
      const year = Number(m[1]);
      const week = Number(m[2]);
      // ISO-8601: week 1 is the week containing 4 January. Find that week's
      // Monday, then jump forward. Mirrors getWeekKey() in lib/utils.ts.
      const jan4 = new Date(year, 0, 4);
      const jan4Monday = new Date(jan4);
      jan4Monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
      const monday = new Date(jan4Monday);
      monday.setDate(jan4Monday.getDate() + (week - 1) * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { start: formatDate(monday), end: formatDate(sunday) };
    }
    case "monthly": {
      const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
      if (!m) return null;
      const year = Number(m[1]);
      const month = Number(m[2]);
      const first = new Date(year, month - 1, 1);
      // Day 0 of the next month is the last day of this one.
      const last = new Date(year, month, 0);
      return { start: formatDate(first), end: formatDate(last) };
    }
    case "yearly": {
      if (!/^\d{4}$/.test(periodKey)) return null;
      return { start: `${periodKey}-01-01`, end: `${periodKey}-12-31` };
    }
  }
}

/**
 * How many periods in a row this task has been completed.
 *
 * The current period is allowed to be open without breaking the run — you
 * haven't failed to do today's task at 9am. So a streak that ended with
 * yesterday still reads as a live streak until tomorrow.
 */
export function computeStreak(
  recurrence: Recurrence,
  checked: Set<string>,
  now: Date = new Date()
): number {
  if (checked.size === 0) return 0;

  let cursor = new Date(now);
  let streak = 0;

  // If the current period isn't ticked yet, start counting from the previous
  // one rather than returning 0.
  if (!checked.has(periodKeyForDate(recurrence, cursor))) {
    cursor = stepBack(recurrence, cursor);
  }

  // Bounded so a corrupt key set can't spin forever.
  for (let i = 0; i < 1000; i++) {
    if (!checked.has(periodKeyForDate(recurrence, cursor))) break;
    streak++;
    cursor = stepBack(recurrence, cursor);
  }

  return streak;
}

// ─── Reading ────────────────────────────────────────────────────────────

export type TaskCheckMap = Record<string, Set<string>>;

/**
 * Every recorded completion for the given tasks, grouped by task id.
 *
 * Deliberately unbounded in time: the whole point of the check table is that
 * it stores one row per completion rather than one per occurrence, so even a
 * daily task run for three years is about a thousand short rows. Fetching
 * them all is what makes the streak exact instead of approximate.
 */
export async function fetchTaskChecks(
  supabase: SupabaseClient,
  userId: string,
  taskIds: string[]
): Promise<TaskCheckMap> {
  if (taskIds.length === 0) return {};

  // Ordered and bounded on purpose. PostgREST caps an unbounded select at the
  // server's `max-rows` (1000 by default) and, without an ORDER BY, which rows
  // you lose is arbitrary — it could drop the CURRENT period, making a task
  // you already ticked render as untouched.
  //
  // Every period-key format sorts lexicographically in chronological order
  // (YYYY-MM-DD, YYYY-Www, YYYY-MM, YYYY), and a task only ever uses one
  // format at a time, so descending gives the most recent periods. If the cap
  // is ever reached it truncates the far end of the streak, never the part
  // being displayed.
  const { data, error } = await supabase
    .from("project_task_checks")
    .select("task_id, period_key")
    .eq("user_id", userId)
    .in("task_id", taskIds)
    .order("period_key", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("[recurrence:fetchTaskChecks]", error.message);
    return {};
  }

  const map: TaskCheckMap = {};
  for (const row of (data || []) as { task_id: string; period_key: string }[]) {
    (map[row.task_id] ??= new Set()).add(row.period_key);
  }
  return map;
}

// ─── Writing ────────────────────────────────────────────────────────────

/**
 * Record or clear a task's completion for one period, and mirror it onto the
 * planner rows that fall inside that period.
 *
 * This is the ONLY place either side is written, which is what keeps the
 * project tab and the calendar from disagreeing — the failure the original
 * "checking in the calendar doesn't check it in the project" bug came from.
 *
 * Every query is awaited. A Supabase query builder is a lazy thenable: left
 * un-awaited it never issues a request at all, and the tick is silently lost.
 */
export async function setTaskCheck(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  recurrence: Recurrence,
  periodKey: string,
  checked: boolean
): Promise<{ error?: string }> {
  try {
    if (checked) {
      // Idempotent: ticking a period that's already ticked is not an error,
      // which matters because two surfaces can toggle the same period.
      const { error } = await supabase
        .from("project_task_checks")
        .upsert(
          { user_id: userId, task_id: taskId, period_key: periodKey },
          { onConflict: "user_id,task_id,period_key", ignoreDuplicates: true }
        );
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase
        .from("project_task_checks")
        .delete()
        .eq("user_id", userId)
        .eq("task_id", taskId)
        .eq("period_key", periodKey);
      if (error) return { error: error.message };
    }

    // Mirror onto the planner. A weekly task may have several occurrences in
    // its week; ticking the period ticks all of them, so the calendar and the
    // project tab agree.
    const range = periodRange(recurrence, periodKey);
    if (range) {
      const { error: mirrorErr } = await supabase
        .from("week_tasks")
        .update({ done: checked })
        .eq("user_id", userId)
        .eq("project_task_id", taskId)
        .is("subtask_id", null)
        .gte("date_key", range.start)
        .lte("date_key", range.end);

      if (mirrorErr) {
        // These are two writes with no transaction between them. If the mirror
        // fails after the check landed, the caller reports failure and rolls
        // its UI back — but the database would keep the check, so a reload
        // would show the tick the user was just told didn't save. Undo the
        // first write so the failure is clean in both places.
        if (checked) {
          await supabase.from("project_task_checks").delete()
            .eq("user_id", userId).eq("task_id", taskId).eq("period_key", periodKey);
        } else {
          await supabase.from("project_task_checks").upsert(
            { user_id: userId, task_id: taskId, period_key: periodKey },
            { onConflict: "user_id,task_id,period_key", ignoreDuplicates: true }
          );
        }
        return { error: mirrorErr.message };
      }
    }

    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Recompute every planner row's `done` for one repeating task from its
 * period checks.
 *
 * The checks are canonical; `week_tasks.done` is a cache. Two things write
 * planner rows without knowing anything about checks, and both leave the
 * cache stale:
 *
 *   - rescheduling (`syncProjectTaskToWeek` regenerates the occurrences at
 *     new dates, and restores `done` by matching the OLD date — so moving a
 *     weekly task from Monday to Wednesday loses the tick for a week the
 *     user has already completed)
 *   - topping the series up (`extendRecurringWeekTasks` inserts new rows
 *     with `done = false`, which is wrong if one lands inside a period that
 *     is already checked)
 *
 * Rather than teach both about periods, this rebuilds the cache from the
 * source of truth. Two bulk updates, no per-row round trips.
 */
export async function reconcileRecurringMirror(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  recurrence: Recurrence
): Promise<{ error?: string; changed?: number }> {
  try {
    const [{ data: checkRows, error: checkErr }, { data: weekRows, error: weekErr }] =
      await Promise.all([
        supabase.from("project_task_checks")
          .select("period_key").eq("user_id", userId).eq("task_id", taskId),
        supabase.from("week_tasks")
          .select("id, date_key, done")
          .eq("user_id", userId).eq("project_task_id", taskId).is("subtask_id", null),
      ]);

    if (checkErr) return { error: checkErr.message };
    if (weekErr) return { error: weekErr.message };
    if (!weekRows || weekRows.length === 0) return { changed: 0 };

    const checked = new Set((checkRows || []).map((c: { period_key: string }) => c.period_key));

    const shouldBeDone: string[] = [];
    const shouldBeOpen: string[] = [];
    for (const r of weekRows as { id: string; date_key: string; done: boolean }[]) {
      const want = checked.has(periodKeyForDateKey(recurrence, r.date_key));
      if (want && !r.done) shouldBeDone.push(r.id);
      else if (!want && r.done) shouldBeOpen.push(r.id);
    }

    if (shouldBeDone.length > 0) {
      const { error } = await supabase.from("week_tasks")
        .update({ done: true }).in("id", shouldBeDone);
      if (error) return { error: error.message };
    }
    if (shouldBeOpen.length > 0) {
      const { error } = await supabase.from("week_tasks")
        .update({ done: false }).in("id", shouldBeOpen);
      if (error) return { error: error.message };
    }

    return { changed: shouldBeDone.length + shouldBeOpen.length };
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * The planner-side half of a tick, shared by every screen that has a
 * checkbox on a planner row: the week grid, the single-day view and the
 * dashboard's "today" list.
 *
 * `handled: true` means STOP — the caller must not go on to write `progress`.
 * That includes the case where the recurrence lookup itself failed: falling
 * through on an unknown recurrence would write `progress = 100` onto a task
 * that may well be repeating, re-creating the exact bug this replaces. When
 * we don't know, we do nothing rather than guess.
 *
 * `handled: false` means the row is definitely not a repeating main task, and
 * the caller carries on exactly as before.
 *
 * It exists as one function rather than three because those three screens
 * previously each hand-rolled the same sync and drifted apart — which is
 * how ticking a task in the calendar came not to check it in the project
 * tab in the first place. Adding a fourth surface should mean calling this,
 * not copying it.
 */
export async function tryRecurringToggle(
  supabase: SupabaseClient,
  userId: string,
  row: { project_task_id: string | null; subtask_id: string | null; date_key: string },
  newDone: boolean
): Promise<{ handled: boolean; recurrence?: Recurrence; periodKey?: string; error?: string }> {
  // Subtask rows keep the old per-subtask progress behaviour: recurrence is a
  // property of the parent task, and a subtask isn't itself repeating.
  if (!row.project_task_id || row.subtask_id) return { handled: false };

  const { data, error } = await supabase
    .from("project_tasks")
    .select("recurrence")
    .eq("id", row.project_task_id)
    .maybeSingle();

  if (error) return { handled: true, error: error.message };

  const recurrence = data?.recurrence as string | null | undefined;
  if (!isRecurrence(recurrence)) return { handled: false };

  const periodKey = periodKeyForDateKey(recurrence, row.date_key);
  const res = await setTaskCheck(
    supabase, userId, row.project_task_id, recurrence, periodKey, newDone
  );

  return { handled: true, recurrence, periodKey, error: res.error };
}
