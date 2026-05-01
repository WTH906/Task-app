import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sync a project task to the weekly planner.
 * Delete-then-insert pattern — handles duplicates and recurrence.
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

    const text = `[${projectTitle}] ${taskName}`;

    // Delete old main-task entries to rebuild cleanly
    await supabase.from("week_tasks").delete()
      .eq("project_task_id", taskId).eq("user_id", userId).is("subtask_id", null);

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

    const inserts = dates.map((dk, i) => ({
      user_id: userId, date_key: dk, text, done: false,
      project_id: projectId, project_task_id: taskId, sort_order: 999 + i,
    }));

    const { error } = await supabase.from("week_tasks").insert(inserts);
    if (error) return { error: error.message };
    return {};
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
    // Always delete existing entries for this subtask first
    await supabase.from("week_tasks").delete()
      .eq("subtask_id", subtaskId).eq("user_id", userId);

    if (!calendarDate) return {};

    const text = `[${projectTitle}] ↳ ${subtaskName}`;

    const { data: maxOrder } = await supabase
      .from("week_tasks").select("sort_order")
      .eq("user_id", userId).eq("date_key", calendarDate)
      .order("sort_order", { ascending: false }).limit(1).maybeSingle();

    const { error } = await supabase.from("week_tasks").insert({
      user_id: userId, date_key: calendarDate, text, done: false,
      project_id: projectId, project_task_id: parentTaskId,
      subtask_id: subtaskId, sort_order: (maxOrder?.sort_order ?? -1) + 1,
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
    const { error } = await supabase.from("week_tasks").delete()
      .eq("project_task_id", taskId).eq("user_id", userId);
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
      target_datetime: `${deadline}T23:59:00`,
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
 * Sync task completion to calendar.
 * Only marks today's and past entries as done (preserves future recurring entries).
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
      // Only mark today's and past calendar entries as done
      await supabase.from("week_tasks").update({ done: true })
        .eq("project_task_id", taskId).eq("user_id", userId)
        .is("subtask_id", null).lte("date_key", today);

      // Remove the deadline
      await supabase.from("deadlines").delete()
        .eq("source_task_id", taskId).eq("user_id", userId);
    } else {
      // Uncompleting — reset all linked week_tasks
      await supabase.from("week_tasks").update({ done: false })
        .eq("project_task_id", taskId).eq("user_id", userId)
        .is("subtask_id", null);
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
