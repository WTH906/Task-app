import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sync a project task to the weekly planner.
 * If the task has a deadline, ensure a week_task exists for that date.
 */
export async function syncProjectTaskToWeek(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  taskName: string,
  projectId: string,
  projectTitle: string,
  deadline: string | null,
  oldDeadline?: string | null
) {
  // If deadline was removed, delete linked week_task
  if (!deadline) {
    await supabase
      .from("week_tasks")
      .delete()
      .eq("project_task_id", taskId)
      .eq("user_id", userId);
    return;
  }

  const text = `[${projectTitle}] ${taskName}`;

  // Check if week_task already exists
  const { data: existing } = await supabase
    .from("week_tasks")
    .select("id, date_key")
    .eq("project_task_id", taskId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    // Update text and date if changed
    await supabase
      .from("week_tasks")
      .update({ text, date_key: deadline })
      .eq("id", existing.id);
  } else {
    // Create new linked week_task
    const { data: maxOrder } = await supabase
      .from("week_tasks")
      .select("sort_order")
      .eq("user_id", userId)
      .eq("date_key", deadline)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    await supabase.from("week_tasks").insert({
      user_id: userId,
      date_key: deadline,
      text,
      done: false,
      project_id: projectId,
      project_task_id: taskId,
      sort_order: (maxOrder?.sort_order ?? -1) + 1,
    });
  }
}

/**
 * When a synced week_task is toggled, update the project task progress.
 */
export async function syncWeekDoneToProject(
  supabase: SupabaseClient,
  weekTaskId: string,
  done: boolean
) {
  const { data: weekTask } = await supabase
    .from("week_tasks")
    .select("project_task_id")
    .eq("id", weekTaskId)
    .maybeSingle();

  if (!weekTask?.project_task_id) return;

  const newProgress = done ? 100 : 0;

  // Check if the project task has subtasks
  const { data: subtasks } = await supabase
    .from("subtasks")
    .select("id")
    .eq("task_id", weekTask.project_task_id)
    .limit(1);

  if (subtasks && subtasks.length > 0) {
    // Has subtasks — don't override, the parent progress is avg of subtasks
    return;
  }

  await supabase
    .from("project_tasks")
    .update({ progress: newProgress })
    .eq("id", weekTask.project_task_id);
}

/**
 * Remove all week_tasks linked to a project task
 */
export async function removeWeekTasksForProjectTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string
) {
  await supabase
    .from("week_tasks")
    .delete()
    .eq("project_task_id", taskId)
    .eq("user_id", userId);
}

/**
 * Sync a project task deadline to the Deadlines tab.
 * Creates/updates/removes a deadline entry tagged with [Project] Task name.
 */
export async function syncTaskDeadlineToDeadlines(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  taskName: string,
  projectTitle: string,
  deadline: string | null
) {
  const label = `[${projectTitle}] ${taskName}`;

  // Find existing deadline for this task (matched by label pattern)
  // We use a convention: store task_id reference in the label
  const { data: existing } = await supabase
    .from("deadlines")
    .select("id")
    .eq("user_id", userId)
    .like("label", `[${projectTitle}] ${taskName}%`)
    .maybeSingle();

  if (!deadline) {
    // Remove deadline if exists
    if (existing) {
      await supabase.from("deadlines").delete().eq("id", existing.id);
    }
    return;
  }

  const target_datetime = `${deadline}T23:59:00`;

  if (existing) {
    await supabase
      .from("deadlines")
      .update({ label, target_datetime })
      .eq("id", existing.id);
  } else {
    await supabase.from("deadlines").insert({
      user_id: userId,
      label,
      target_datetime,
    });
  }
}
