import { SupabaseClient } from "@supabase/supabase-js";
import {
  Project, ProjectTask, Subtask, RoutineTask, WeeklyRoutineTask, MonthlyRoutineTask,
  WeekTask, WeekDay, WeekTemplate, Deadline, ActivityLog,
  Template, QuickTask,
} from "@/lib/types";

// ─── Error Handling ────────────────────────────────────────────

/**
 * Log query errors consistently. Pages never crash from a failed query —
 * they render with empty data and the error is logged for debugging.
 */
function logQueryError(fn: string, error: { message: string; code?: string }) {
  console.error(`[queries.${fn}]`, error.message, error.code || "");
  // Surface to UI via custom event (caught by AppShell toast listener)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("query-error", {
      detail: { fn, message: error.message, code: error.code },
    }));
  }
}

// ─── Helpers ───────────────────────────────────────────────────

async function attachSubtasks(
  supabase: SupabaseClient,
  tasks: ProjectTask[]
): Promise<ProjectTask[]> {
  if (tasks.length === 0) return [];

  const taskIds = tasks.map((t) => t.id);
  const { data: allSubs, error } = await supabase
    .from("subtasks")
    .select("*")
    .in("task_id", taskIds)
    .order("sort_order");

  if (error) {
    logQueryError("attachSubtasks", error);
    return tasks.map((t) => ({ ...t, subtasks: [] }));
  }

  const subsByTask: Record<string, Subtask[]> = {};
  for (const s of (allSubs || []) as Subtask[]) {
    (subsByTask[s.task_id] ||= []).push(s);
  }

  return tasks.map((t) => ({ ...t, subtasks: subsByTask[t.id] || [] }));
}

// ─── Projects ──────────────────────────────────────────────────

export async function fetchProjects(
  supabase: SupabaseClient,
  userId: string
): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("sort_order");
  if (error) { logQueryError("fetchProjects", error); return []; }
  return (data || []) as Project[];
}

export async function fetchProjectsSlim(
  supabase: SupabaseClient,
  userId: string
): Promise<Array<{ id: string; title: string; color: string }>> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, color")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("sort_order");
  if (error) { logQueryError("fetchProjectsSlim", error); return []; }
  return (data || []) as Array<{ id: string; title: string; color: string }>;
}

export async function fetchProjectById(
  supabase: SupabaseClient,
  projectId: string
): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (error) { logQueryError("fetchProjectById", error); return null; }
  return data as Project;
}

// ─── Project Tasks ─────────────────────────────────────────────

export async function fetchProjectTasksWithSubs(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectTask[]> {
  const { data: taskData, error } = await supabase
    .from("project_tasks")
    .select("*")
    .eq("project_id", projectId)
    .is("archived_at", null)
    .order("sort_order");
  if (error) { logQueryError("fetchProjectTasksWithSubs", error); return []; }
  return attachSubtasks(supabase, (taskData || []) as ProjectTask[]);
}

export async function fetchProjectTasksSlim(
  supabase: SupabaseClient,
  projectId: string
): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase
    .from("project_tasks")
    .select("id, name")
    .eq("project_id", projectId)
    .is("archived_at", null)
    .order("sort_order");
  if (error) { logQueryError("fetchProjectTasksSlim", error); return []; }
  return (data || []) as Array<{ id: string; name: string }>;
}

export async function fetchOverdueTasks(
  supabase: SupabaseClient,
  userId: string,
  today: string
): Promise<Array<ProjectTask & { projectTitle: string; projectColor: string }>> {
  const { data: tasks, error } = await supabase
    .from("project_tasks")
    .select("*")
    .eq("user_id", userId)
    .is("archived_at", null)
    .lt("deadline", today)
    .lt("progress", 100)
    .not("deadline", "is", null)
    .order("deadline");

  if (error) { logQueryError("fetchOverdueTasks", error); return []; }

  const projectIds = [...new Set((tasks || []).map((t: ProjectTask) => t.project_id))];
  const projMap: Record<string, { title: string; color: string }> = {};

  if (projectIds.length > 0) {
    const { data: projs } = await supabase
      .from("projects")
      .select("id, title, color")
      .in("id", projectIds);
    for (const p of projs || []) {
      projMap[p.id] = { title: p.title, color: p.color || "#e05555" };
    }
  }

  return (tasks || []).map((t: ProjectTask) => ({
    ...t,
    projectTitle: projMap[t.project_id]?.title || "Unknown",
    projectColor: projMap[t.project_id]?.color || "#e05555",
  }));
}

export async function fetchTaskDeadlines(
  supabase: SupabaseClient,
  userId: string
): Promise<Array<{ id: string; name: string; deadline: string; project_id: string; progress: number }>> {
  const { data, error } = await supabase
    .from("project_tasks")
    .select("id, name, deadline, project_id, progress")
    .eq("user_id", userId)
    .is("archived_at", null)
    .not("deadline", "is", null);
  if (error) { logQueryError("fetchTaskDeadlines", error); return []; }
  return (data || []) as Array<{ id: string; name: string; deadline: string; project_id: string; progress: number }>;
}

// ─── Routine ───────────────────────────────────────────────────

export async function fetchRoutineWithChecks(
  supabase: SupabaseClient,
  userId: string,
  dateKey: string
): Promise<RoutineTask[]> {
  const { data: tasks, error: tErr } = await supabase
    .from("routine_tasks")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order");

  if (tErr) { logQueryError("fetchRoutineWithChecks", tErr); return []; }

  const { data: checks } = await supabase
    .from("routine_checks")
    .select("task_id")
    .eq("user_id", userId)
    .eq("checked_date", dateKey);

  const checkedIds = new Set((checks || []).map((c: { task_id: string }) => c.task_id));

  return (tasks || []).map((t: RoutineTask) => ({
    ...t,
    checked: checkedIds.has(t.id),
  }));
}

export async function fetchWeeklyRoutineWithChecks(
  supabase: SupabaseClient,
  userId: string,
  weekKey: string
): Promise<WeeklyRoutineTask[]> {
  const { data: tasks, error: tErr } = await supabase
    .from("weekly_routine_tasks")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order");

  if (tErr) { logQueryError("fetchWeeklyRoutineWithChecks", tErr); return []; }

  const { data: checks } = await supabase
    .from("weekly_routine_checks")
    .select("task_id")
    .eq("user_id", userId)
    .eq("week_key", weekKey);

  const checkedIds = new Set((checks || []).map((c: { task_id: string }) => c.task_id));

  return (tasks || []).map((t: WeeklyRoutineTask) => ({
    ...t,
    checked: checkedIds.has(t.id),
  }));
}

export async function fetchMonthlyRoutineWithChecks(
  supabase: SupabaseClient,
  userId: string,
  monthKey: string
): Promise<MonthlyRoutineTask[]> {
  const { data: tasks, error: tErr } = await supabase
    .from("monthly_routine_tasks")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order");

  if (tErr) { logQueryError("fetchMonthlyRoutineWithChecks", tErr); return []; }

  const { data: checks } = await supabase
    .from("monthly_routine_checks")
    .select("task_id")
    .eq("user_id", userId)
    .eq("month_key", monthKey);

  const checkedIds = new Set((checks || []).map((c: { task_id: string }) => c.task_id));

  return (tasks || []).map((t: MonthlyRoutineTask) => ({
    ...t,
    checked: checkedIds.has(t.id),
  }));
}

// ─── Week Planner ──────────────────────────────────────────────

export async function fetchWeekTasksGrouped(
  supabase: SupabaseClient,
  userId: string,
  dateKeys: string[]
): Promise<Record<string, WeekTask[]>> {
  const grouped: Record<string, WeekTask[]> = {};
  for (const dk of dateKeys) grouped[dk] = [];

  const { data, error } = await supabase
    .from("week_tasks")
    .select("*")
    .eq("user_id", userId)
    .in("date_key", dateKeys)
    .order("sort_order");

  if (error) { logQueryError("fetchWeekTasksGrouped", error); return grouped; }

  for (const t of (data || []) as WeekTask[]) {
    if (!grouped[t.date_key]) grouped[t.date_key] = [];
    grouped[t.date_key].push(t);
  }
  return grouped;
}

export async function fetchWeekTasksForDate(
  supabase: SupabaseClient,
  userId: string,
  dateKey: string
): Promise<WeekTask[]> {
  const { data, error } = await supabase
    .from("week_tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("date_key", dateKey)
    .order("sort_order");
  if (error) { logQueryError("fetchWeekTasksForDate", error); return []; }
  return (data || []) as WeekTask[];
}

export async function fetchWeekDayMeta(
  supabase: SupabaseClient,
  userId: string,
  dateKeys: string[]
): Promise<Record<string, WeekDay>> {
  const { data, error } = await supabase
    .from("week_days")
    .select("*")
    .eq("user_id", userId)
    .in("date_key", dateKeys);

  if (error) { logQueryError("fetchWeekDayMeta", error); return {}; }

  const meta: Record<string, WeekDay> = {};
  for (const d of (data || []) as WeekDay[]) meta[d.date_key] = d;
  return meta;
}

export async function fetchWeekDayMetaSingle(
  supabase: SupabaseClient,
  userId: string,
  dateKey: string
): Promise<WeekDay | null> {
  const { data, error } = await supabase
    .from("week_days")
    .select("*")
    .eq("user_id", userId)
    .eq("date_key", dateKey)
    .maybeSingle();
  if (error) { logQueryError("fetchWeekDayMetaSingle", error); return null; }
  return data as WeekDay | null;
}

export async function fetchWeekTemplates(
  supabase: SupabaseClient,
  userId: string
): Promise<Record<number, string>> {
  const { data, error } = await supabase
    .from("week_templates")
    .select("*")
    .eq("user_id", userId);

  if (error) { logQueryError("fetchWeekTemplates", error); return {}; }

  const templates: Record<number, string> = {};
  for (const wt of (data || []) as WeekTemplate[]) {
    templates[wt.weekday] = wt.title;
  }
  return templates;
}

export async function fetchWeekTemplateSingle(
  supabase: SupabaseClient,
  userId: string,
  weekday: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from("week_templates")
    .select("title")
    .eq("user_id", userId)
    .eq("weekday", weekday)
    .maybeSingle();
  if (error) { logQueryError("fetchWeekTemplateSingle", error); return null; }
  return data?.title || null;
}

// ─── Deadlines ─────────────────────────────────────────────────

export async function fetchDeadlines(
  supabase: SupabaseClient,
  userId: string
): Promise<Deadline[]> {
  const { data, error } = await supabase
    .from("deadlines")
    .select("*")
    .eq("user_id", userId)
    .order("target_datetime");
  if (error) { logQueryError("fetchDeadlines", error); return []; }
  return (data || []) as Deadline[];
}

export async function fetchUpcomingDeadlines(
  supabase: SupabaseClient,
  userId: string,
  limit: number = 6
): Promise<Deadline[]> {
  const { data, error } = await supabase
    .from("deadlines")
    .select("*")
    .eq("user_id", userId)
    .gte("target_datetime", new Date().toISOString())
    .order("target_datetime")
    .limit(limit);
  if (error) { logQueryError("fetchUpcomingDeadlines", error); return []; }
  return (data || []) as Deadline[];
}

// ─── Activity ──────────────────────────────────────────────────

export async function fetchRecentActivity(
  supabase: SupabaseClient,
  userId: string,
  limit: number = 10
): Promise<ActivityLog[]> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { logQueryError("fetchRecentActivity", error); return []; }
  return (data || []) as ActivityLog[];
}

// ─── Templates ─────────────────────────────────────────────────

export async function fetchTemplates(
  supabase: SupabaseClient,
  userId: string
): Promise<Template[]> {
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) { logQueryError("fetchTemplates", error); return []; }
  return (data || []) as Template[];
}

// ─── Roadmap ───────────────────────────────────────────────────

export async function fetchRoadmapData(
  supabase: SupabaseClient,
  userId: string,
  projectId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[] | null> {
  const { data, error } = await supabase
    .from("roadmap_data")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) { logQueryError("fetchRoadmapData", error); return null; }
  return data?.phases || null;
}

// ─── Quick Tasks ───────────────────────────────────────────────

export async function fetchQuickTasks(
  supabase: SupabaseClient,
  userId: string
): Promise<QuickTask[]> {
  const { data, error } = await supabase
    .from("quick_tasks")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order");
  if (error) { logQueryError("fetchQuickTasks", error); return []; }
  return (data || []) as QuickTask[];
}
