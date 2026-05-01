import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sync a project task to the weekly planner.
 * Creates/updates/removes week_tasks linked by project_task_id.
 * If recurrence is set, creates entries for upcoming occurrences.
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
    // Only touch main-task week_tasks (subtask_id IS NULL), not subtask entries
    if (!calendarDate) {
      const { error } = await supabase
        .from("week_tasks")
        .delete()
        .eq("project_task_id", taskId)
        .eq("user_id", userId)
        .is("subtask_id", null);
      if (error) return { error: error.message };
      return {};
    }

    const text = `[${projectTitle}] ${taskName}`;

    // Delete old main-task entries to rebuild cleanly
    await supabase
      .from("week_tasks")
      .delete()
      .eq("project_task_id", taskId)
      .eq("user_id", userId)
      .is("subtask_id", null);

    // Generate dates: base date + recurring occurrences
    const dates = [calendarDate];
    if (recurrence) {
      const base = new Date(calendarDate + "T00:00:00");
      const count = recurrence === "daily" ? 6 : recurrence === "weekly" ? 3 : recurrence === "monthly" ? 2 : 0;
      for (let i = 1; i <= count; i++) {
        const d = new Date(base);
        if (recurrence === "daily") d.setDate(d.getDate() + i);
        else if (recurrence === "weekly") d.setDate(d.getDate() + i * 7);
        else if (recurrence === "monthly") d.setMonth(d.getMonth() + i);
        else if (recurrence === "yearly") d.setFullYear(d.getFullYear() + i);
        dates.push(d.toISOString().slice(0, 10));
      }
    }

    // Insert week_tasks for all dates
    const inserts = dates.map((dk, i) => ({
      user_id: userId,
      date_key: dk,
      text,
      done: false,
      project_id: projectId,
      project_task_id: taskId,
      sort_order: 999 + i,
    }));

    const { error } = await supabase.from("week_tasks").insert(inserts);
    if (error) return { error: error.message };

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
    // Always delete existing entries for this subtask first (handles duplicates)
    await supabase
      .from("week_tasks")
      .delete()
      .eq("subtask_id", subtaskId)
      .eq("user_id", userId);

    // If no date, we're done (entry removed)
    if (!calendarDate) return {};

    // ↳ in display text is purely cosmetic — not used for matching
    const text = `[${projectTitle}] ↳ ${subtaskName}`;

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

    // Always delete existing deadlines for this task first (handles duplicates)
    await supabase
      .from("deadlines")
      .delete()
      .eq("source_task_id", taskId)
      .eq("user_id", userId);

    // If no deadline, we're done (entry removed)
    if (!deadline) return {};

    const target_datetime = `${deadline}T23:59:00`;

    const { error } = await supabase.from("deadlines").insert({
      user_id: userId,
      label,
      target_datetime,
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
    const today = new Date().toISOString().slice(0, 10);

    if (isDone) {
      // Only mark today's and past calendar entries as done (don't touch future recurring entries)
      const { error: weekErr } = await supabase
        .from("week_tasks")
        .update({ done: true })
        .eq("project_task_id", taskId)
        .eq("user_id", userId)
        .is("subtask_id", null)
        .lte("date_key", today);

      if (weekErr) return { error: weekErr.message };

      // Remove the deadline
      const { error } = await supabase
        .from("deadlines")
        .delete()
        .eq("source_task_id", taskId)
        .eq("user_id", userId);
      if (error) return { error: error.message };
    } else {
      // Uncompleting — reset all linked week_tasks
      const { error: weekErr } = await supabase
        .from("week_tasks")
        .update({ done: false })
        .eq("project_task_id", taskId)
        .eq("user_id", userId)
        .is("subtask_id", null);

      if (weekErr) return { error: weekErr.message };
    }

    return {};
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Sync subtask completion to linked week_tasks.
 * When a subtask is checked/unchecked, update the calendar entry.
 */
export async function syncSubtaskCompletion(
  supabase: SupabaseClient,
  userId: string,
  subtaskId: string,
  progress: number
): Promise<{ error?: string }> {
  try {
    const isDone = progress >= 100;

    // Mark linked week_tasks for this subtask
    const { error } = await supabase
      .from("week_tasks")
      .update({ done: isDone })
      .eq("subtask_id", subtaskId)
      .eq("user_id", userId);

    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: String(e) };
  }
}
