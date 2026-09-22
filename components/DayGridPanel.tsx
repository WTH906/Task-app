"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { WeekTask } from "@/lib/types";
import { DAY_COLORS, formatDate, LEGACY_TAG_RE } from "@/lib/utils";
import { DayGrid } from "@/components/DayGrid";
import { ScheduleModal, type ScheduleTarget } from "@/components/ScheduleModal";
import { type Block, hasBlock } from "@/lib/schedule";
import {
  fetchDayEstimates, estimateForTask, writeBlock, clearBlockOn,
  createPlannerTaskInSlot, toggleWeekTaskDone,
} from "@/lib/day-blocks";
import { rescheduleWeekTask } from "@/lib/sync";
import { announceTaskChanged } from "@/lib/task-events";
import { fetchWeekTasksForDate } from "@/lib/queries";
import { injectRoutineTasksForDay } from "@/lib/routine-scheduler";
import { useSettings } from "@/lib/hooks/useSettings";
import { useToast } from "@/components/Toast";

interface Props {
  dateKey: string;
  userId: string;
  projectColorById: Record<string, string>;
  projectTitleById: Record<string, string>;
  /** Told when anything changed, so the page behind can refresh its own copy. */
  onChanged?: () => void;
}

/**
 * One day's hour grid, loading and saving its own data.
 *
 * Self-contained on purpose: it is rendered inside a popup on the week view,
 * where the surrounding page holds every day at once and has no per-day
 * state to lend it. All of its writes go through lib/day-blocks.ts, which is
 * the same code the full day page uses — so the popup and the page can't
 * drift apart, which is the failure mode this codebase keeps producing when
 * one operation gets hand-written per screen.
 */
export function DayGridPanel({
  dateKey, userId, projectColorById, projectTitleById, onChanged,
}: Props) {
  const { toast } = useToast();
  const { has } = useSettings();
  const [tasks, setTasks] = useState<WeekTask[]>([]);
  const [estimates, setEstimates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);

  const dayNum = new Date(dateKey + "T00:00:00").getDay();
  const color = DAY_COLORS[dayNum];
  // formatDate, never toISOString — the latter converts to UTC first and
  // reports the wrong day for anyone east of Greenwich in the evening.
  const isToday = dateKey === formatDate(new Date());

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const supabase = createClient();
      if (has("routineInScheduler")) {
        await injectRoutineTasksForDay(supabase, userId, dateKey);
      }
      const rows = await fetchWeekTasksForDate(supabase, userId, dateKey);
      setTasks(rows);
      setEstimates(await fetchDayEstimates(supabase, rows));
    } catch (err) {
      console.error("[day-panel:load]", err);
      toast("Couldn't load that day", "error");
    } finally {
      setLoading(false);
    }
  }, [dateKey, userId, toast, has]);

  useEffect(() => {
    load().catch((err) => console.error("[day-panel:load]", err));
  }, [load]);

  const changed = () => onChanged?.();

  const stripTag = (t: WeekTask) => (t.project_id ? t.text.replace(LEGACY_TAG_RE, "") : t.text);

  const toggleDone = async (task: WeekTask) => {
    const newDone = !task.done;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: newDone } : t)));

    const supabase = createClient();
    const { error } = await toggleWeekTaskDone(supabase, userId, task, newDone, "planner");
    if (error) {
      toast("Couldn't save: " + error, "error");
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !newDone } : t)));
      return;
    }
    changed();
  };

  const setBlock = async (taskId: string, block: Block) => {
    const before = tasks.find((t) => t.id === taskId);
    setTasks((prev) => prev.map((t) => (t.id === taskId
      ? { ...t, start_minute: block.start, end_minute: block.end } : t)));

    const { error } = await writeBlock(createClient(), taskId, block);
    if (error) {
      toast("Couldn't save the time: " + error, "error");
      if (before) {
        setTasks((prev) => prev.map((t) => (t.id === taskId
          ? { ...t, start_minute: before.start_minute, end_minute: before.end_minute } : t)));
      }
      return;
    }
    changed();
  };

  const clearBlock = async (taskId: string) => {
    const before = tasks.find((t) => t.id === taskId);
    setTasks((prev) => prev.map((t) => (t.id === taskId
      ? { ...t, start_minute: null, end_minute: null } : t)));

    const { error } = await clearBlockOn(createClient(), taskId);
    if (error) {
      toast("Couldn't clear the time: " + error, "error");
      if (before) {
        setTasks((prev) => prev.map((t) => (t.id === taskId
          ? { ...t, start_minute: before.start_minute, end_minute: before.end_minute } : t)));
      }
      return;
    }
    changed();
  };

  const createInSlot = async (text: string, block: Block) => {
    const { row, error } = await createPlannerTaskInSlot(
      createClient(), userId, dateKey, text, block, tasks.length
    );
    if (error) { toast("Couldn't add that: " + error, "error"); return; }
    if (row) setTasks((prev) => [...prev, row]);
    changed();
  };

  const removeTask = async (taskId: string) => {
    const before = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    const { error } = await createClient().from("week_tasks").delete().eq("id", taskId);
    if (error) {
      toast("Couldn't remove that: " + error.message, "error");
      setTasks(before);
      return;
    }
    changed();
  };

  const openPicker = (t: WeekTask) => {
    setScheduleTarget({
      id: t.id,
      label: stripTag(t),
      dateKey,
      estMinutes: estimateForTask(t, estimates),
      current: hasBlock(t)
        ? { start: t.start_minute as number, end: t.end_minute as number }
        : null,
      existing: tasks
        .filter((x) => x.id !== t.id && hasBlock(x))
        .map((x) => ({ start: x.start_minute as number, end: x.end_minute as number })),
    });
  };

  /** Save from the picker. A changed day is a reschedule, not an edit. */
  const savePicker = async (taskId: string, block: Block | null, newDate?: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (newDate) {
      const res = await rescheduleWeekTask(
        createClient(), userId,
        { ...task, start_minute: block?.start ?? null, end_minute: block?.end ?? null },
        newDate
      );
      if (res.error) { toast("Couldn't move it: " + res.error, "error"); return; }
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, rescheduled_to: newDate } : t)));
      announceTaskChanged({ taskId: task.project_task_id, source: "planner" });
      toast(`Moved to ${newDate}`, "success");
      changed();
      return;
    }

    if (block) await setBlock(taskId, block);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-violet border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <DayGrid
        tasks={tasks}
        isToday={isToday}
        color={color}
        projectColorById={projectColorById}
        projectTitleById={projectTitleById}
        estimateFor={(t) => estimateForTask(t, estimates)}
        onToggleDone={toggleDone}
        onSetBlock={setBlock}
        onClearBlock={clearBlock}
        onOpenPicker={openPicker}
        onCreateInSlot={createInSlot}
        onDelete={removeTask}
        stripTag={stripTag}
      />

      <ScheduleModal
        target={scheduleTarget}
        isToday={isToday}
        onClose={() => setScheduleTarget(null)}
        onSave={savePicker}
        onClear={clearBlock}
      />
    </>
  );
}
