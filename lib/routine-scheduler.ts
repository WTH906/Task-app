import { SupabaseClient } from "@supabase/supabase-js";
import { getWeekKey, getMonthKey } from "./utils";

interface RoutineSource {
  id: string;
  text: string;
  est_minutes: number;
  type: "daily" | "weekly" | "monthly" | "yearly";
}

export async function injectRoutineTasksForDay(
  supabase: SupabaseClient,
  userId: string,
  dateKey: string
): Promise<void> {
  const d = new Date(dateKey + "T00:00:00");
  const dayOfWeek = (d.getDay() + 6) % 7; // 0=Mon..6=Sun (matches day_of_week column)
  const dayOfMonth = d.getDate();
  const month = d.getMonth() + 1; // 1-12

  const sources: RoutineSource[] = [];

  const [daily, weekly, monthly, yearly] = await Promise.all([
    supabase.from("routine_tasks").select("id, text, est_minutes").eq("user_id", userId),
    supabase.from("weekly_routine_tasks").select("id, text, est_minutes, day_of_week").eq("user_id", userId).eq("day_of_week", dayOfWeek),
    supabase.from("monthly_routine_tasks").select("id, text, est_minutes, date_from").eq("user_id", userId).eq("date_from", dayOfMonth),
    supabase.from("yearly_routine_tasks").select("id, text, est_minutes, month_from, day_from").eq("user_id", userId).eq("month_from", month).eq("day_from", dayOfMonth),
  ]);

  for (const r of (daily.data || [])) sources.push({ id: r.id, text: r.text, est_minutes: r.est_minutes, type: "daily" });
  for (const r of (weekly.data || [])) sources.push({ id: r.id, text: r.text, est_minutes: r.est_minutes, type: "weekly" });
  for (const r of (monthly.data || [])) sources.push({ id: r.id, text: r.text, est_minutes: r.est_minutes, type: "monthly" });
  for (const r of (yearly.data || [])) sources.push({ id: r.id, text: r.text, est_minutes: r.est_minutes, type: "yearly" });

  if (sources.length === 0) return;

  const { data: existing } = await supabase
    .from("week_tasks")
    .select("routine_task_id")
    .eq("user_id", userId)
    .eq("date_key", dateKey)
    .not("routine_task_id", "is", null);

  const existingIds = new Set((existing || []).map((r: { routine_task_id: string }) => r.routine_task_id));

  const toInsert = sources
    .filter((s) => !existingIds.has(s.id))
    .map((s, i) => ({
      user_id: userId,
      date_key: dateKey,
      text: s.text,
      done: false,
      project_id: null,
      project_task_id: null,
      subtask_id: null,
      sort_order: 900 + i,
      routine_task_id: s.id,
      routine_type: s.type,
    }));

  if (toInsert.length === 0) return;

  // Check done state from the routine check tables so the grid matches the
  // routine pages. Fire all four in parallel — most will have zero ids.
  const dailyIds = toInsert.filter((r) => r.routine_type === "daily").map((r) => r.routine_task_id);
  const weeklyIds = toInsert.filter((r) => r.routine_type === "weekly").map((r) => r.routine_task_id);
  const monthlyIds = toInsert.filter((r) => r.routine_type === "monthly").map((r) => r.routine_task_id);
  const yearlyIds = toInsert.filter((r) => r.routine_type === "yearly").map((r) => r.routine_task_id);

  const none = Promise.resolve({ data: [] as { task_id: string }[] });
  const [dailyChecks, weeklyChecks, monthlyChecks, yearlyChecks] = await Promise.all([
    dailyIds.length ? supabase.from("routine_checks").select("task_id").eq("user_id", userId).eq("checked_date", dateKey).in("task_id", dailyIds) : none,
    weeklyIds.length ? supabase.from("weekly_routine_checks").select("task_id").eq("user_id", userId).eq("week_key", getWeekKey(d)).in("task_id", weeklyIds) : none,
    monthlyIds.length ? supabase.from("monthly_routine_checks").select("task_id").eq("user_id", userId).eq("month_key", getMonthKey(d)).in("task_id", monthlyIds) : none,
    yearlyIds.length ? supabase.from("yearly_routine_checks").select("task_id").eq("user_id", userId).eq("year", d.getFullYear()).in("task_id", yearlyIds) : none,
  ]);

  const checkedIds = new Set([
    ...(dailyChecks.data || []).map((r: { task_id: string }) => r.task_id),
    ...(weeklyChecks.data || []).map((r: { task_id: string }) => r.task_id),
    ...(monthlyChecks.data || []).map((r: { task_id: string }) => r.task_id),
    ...(yearlyChecks.data || []).map((r: { task_id: string }) => r.task_id),
  ]);

  for (const row of toInsert) {
    if (checkedIds.has(row.routine_task_id)) row.done = true;
  }

  const { error } = await supabase.from("week_tasks").insert(toInsert);
  if (error) console.error("[routine-inject]", error.message, { dateKey, count: toInsert.length });
}

/**
 * Sync a routine task's done state to the appropriate check table.
 * Called when toggling a routine week_task in the scheduler.
 */
export async function syncRoutineCheck(
  supabase: SupabaseClient,
  userId: string,
  routineTaskId: string,
  routineType: string,
  dateKey: string,
  done: boolean
): Promise<{ error?: string }> {
  const d = new Date(dateKey + "T00:00:00");

  try {
    if (routineType === "daily") {
      if (done) {
        await supabase.from("routine_checks").insert({ user_id: userId, task_id: routineTaskId, checked_date: dateKey });
      } else {
        await supabase.from("routine_checks").delete().eq("user_id", userId).eq("task_id", routineTaskId).eq("checked_date", dateKey);
      }
    } else if (routineType === "weekly") {
      const weekKey = getWeekKey(d);
      if (done) {
        await supabase.from("weekly_routine_checks").insert({ user_id: userId, task_id: routineTaskId, week_key: weekKey });
      } else {
        await supabase.from("weekly_routine_checks").delete().eq("user_id", userId).eq("task_id", routineTaskId).eq("week_key", weekKey);
      }
    } else if (routineType === "monthly") {
      const monthKey = getMonthKey(d);
      if (done) {
        await supabase.from("monthly_routine_checks").insert({ user_id: userId, task_id: routineTaskId, month_key: monthKey });
      } else {
        await supabase.from("monthly_routine_checks").delete().eq("user_id", userId).eq("task_id", routineTaskId).eq("month_key", monthKey);
      }
    } else if (routineType === "yearly") {
      const year = d.getFullYear();
      if (done) {
        await supabase.from("yearly_routine_checks").upsert({ user_id: userId, task_id: routineTaskId, year, checked: true, checked_at: new Date().toISOString() });
      } else {
        await supabase.from("yearly_routine_checks").upsert({ user_id: userId, task_id: routineTaskId, year, checked: false, checked_at: null });
      }
    }
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}
