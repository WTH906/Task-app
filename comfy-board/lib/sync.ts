import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sync a project task to the weekly planner.
 * Creates/updates/removes a week_task linked by project_task_id.
 */
export async function syncProjectTaskToWeek(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  taskName: string,
  projectId: string,
  projectTitle: string,
  calendarDate: string | null,
  oldDate?: string | null
): Promise<{ error?: string }> {
  try {
    // If date was removed, delete linked week_task
    if (!calendarDate) {
      const { error } = await supabase
        .from("week_tasks")
        .delete()
        .eq("project_task_id", taskId)
        .eq("user_id", userId);
      if (error) return { error: error.message };
      return {};
    }

    const text = `[${projectTitle}] ${taskName}`;

    // Check if week_task already exists for this project task
    const { data: existing, error: findErr } = await supabase
      .from("week_tasks")
      .select("id, date_key")
      .eq("project_task_id", taskId)
      .eq("user_id", userId)
      .maybeSingle();

    if (findErr) return { error: findErr.message };

    if (existing) {
      // Update text and date
      const { error } = await supabase
        .from("week_tasks")
        .update({ text, date_key: calendarDate })
        .eq("id", existing.id);
      if (error) return { error: error.message };
    } else {
      // Create new linked week_task
      const { data: maxOrder } = await supabase
        .from("week_tasks")
        .select("sort_order")
        .eq("user_id", userId)
        .eq("date_key", calendarDate)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error } = await supabase.from("week_tasks").insert({
        user_id: userId,
        date_key: calendarDate,
        text,
        done: false,
        project_id: projectId,
        project_task_id: taskId,
        sort_order: (maxOrder?.sort_order ?? -1) + 1,
      });
      if (error) return { error: error.message };
    }
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Sync a subtask to the weekly planner.
 * Creates/updates/removes a week_task linked by subtask_id (the FK, not text matching).
 * Also stores project_task_id (parent) and project_id for cross-joins.
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
    // If date was removed, delete linked week_task
    if (!calendarDate) {
      const { error } = await supabase
        .from("week_tasks")
        .delete()
        .eq("subtask_id", subtaskId)
        .eq("user_id", userId);
      if (error) return { error: error.message };
      return {};
    }

    // ↳ in display text is purely cosmetic now — not used for matching
    const text = `[${projectTitle}] ↳ ${subtaskName}`;

    // Match by subtask_id (FK)
    const { data: existing, error: findErr } = await supabase
      .from("week_tasks")
      .select("id")
      .eq("subtask_id", subtaskId)
      .eq("user_id", userId)
      .maybeSingle();

    if (findErr) return { error: findErr.message };

    if (existing) {
      const { error } = await supabase
        .from("week_tasks")
        .update({ text, date_key: calendarDate })
        .eq("id", existing.id);
      if (error) return { error: error.message };
    } else {
      const { data: maxOrder } = await supabase
        .from("week_tasks")
        .select("sort_order")
        .eq("user_id", userId)
        .eq("date_key", calendarDate)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error } = await supabase.from("week_tasks").insert({
        user_id: userId,
        date_key: calendarDate,
        text,
        done: false,
        project_id: projectId,
        project_task_id: parentTaskId,
        subtask_id: subtaskId,
        sort_order: (maxOrder?.sort_order ?? -1) + 1,
      });
      if (error) return { error: error.message };
    }
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Sync a project task's deadline to the Deadlines tab.
 * Uses source_task_id foreign key (not label matching).
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

    // Find existing deadline by source_task_id (proper FK)
    const { data: existing, error: findErr } = await supabase
      .from("deadlines")
      .select("id")
      .eq("source_task_id", taskId)
      .eq("user_id", userId)
      .maybeSingle();

    if (findErr) return { error: findErr.message };

    if (!deadline) {
      // Remove deadline
      if (existing) {
        const { error } = await supabase.from("deadlines").delete().eq("id", existing.id);
        if (error) return { error: error.message };
      }
      return {};
    }

    const target_datetime = `${deadline}T23:59:00`;

    if (existing) {
      const { error } = await supabase
        .from("deadlines")
        .update({ label, target_datetime, ...(recurrence !== undefined ? { recurrence } : {}) })
        .eq("id", existing.id);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from("deadlines").insert({
        user_id: userId,
        label,
        target_datetime,
        source_task_id: taskId,
        ...(recurrence ? { recurrence } : {}),
      });
      if (error) return { error: error.message };
    }
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Remove all week_tasks linked to a project task.
 */
export async function removeWeekTasksForProjectTask(
  supabase: SupabaseClient,
  userId: string,
  taskId: string
): Promise<{ error?: string }> {
  try {
    const { error } = await supabase
      .from("week_tasks")
      .delete()
      .eq("project_task_id", taskId)
      .eq("user_id", userId);
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * When a task reaches 100%, mark linked week_tasks done and remove deadline.
 */
export async function syncTaskCompletion(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
  progress: number
): Promise<{ error?: string }> {
  try {
    const isDone = progress >= 100;

    // Mark linked week_tasks — only main task entries (not subtask entries)
    // Subtask week_tasks have their own independent done state
    const { data: linkedWeek, error: weekErr } = await supabase
      .from("week_tasks")
      .select("id")
      .eq("project_task_id", taskId)
      .eq("user_id", userId)
      .is("subtask_id", null);

    if (weekErr) return { error: weekErr.message };

    for (const wt of linkedWeek || []) {
      await supabase.from("week_tasks").update({ done: isDone }).eq("id", wt.id);
    }

    // If completing, remove the deadline
    if (isDone) {
      const { error } = await supabase
        .from("deadlines")
        .delete()
        .eq("source_task_id", taskId)
        .eq("user_id", userId);
      if (error) return { error: error.message };
    }

    return {};
  } catch (e) {
    return { error: String(e) };
  }
}
