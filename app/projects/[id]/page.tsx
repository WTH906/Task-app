"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Project, ProjectTask, Subtask } from "@/lib/types";
import { formatSeconds, formatMinutes, cn, todayKey } from "@/lib/utils";
import {
  isRecurrence, currentPeriodKey, fetchTaskChecks, setTaskCheck,
  reconcileRecurringMirror, type TaskCheckMap,
} from "@/lib/recurrence";
import { ScheduleModal, type ScheduleTarget } from "@/components/ScheduleModal";
import { type Block, describeBlock } from "@/lib/schedule";
import { onTaskChanged } from "@/lib/task-events";
import { useTimer } from "@/lib/hooks/useTimer";
import { ProgressBar } from "@/components/ProgressBar";
import { InlineEdit } from "@/components/InlineEdit";
import { CalendarPicker } from "@/components/CalendarPicker";
import { Modal } from "@/components/Modal";
import {
  syncProjectTaskToWeek, syncSubtaskToWeek, removeWeekTasksForProjectTask,
  syncTaskDeadlineToDeadlines, syncTaskCompletion, syncSubtaskCompletion,
  syncSubtaskRename, recalcParentFromSubtasks, removeTaskMirrors, deadlineTimestamp,
  rescheduleWeekTask,
} from "@/lib/sync";
import { GCalSyncModal } from "@/components/GCalButton";
import { ColorPicker } from "@/components/ColorPicker";
import { logActivity } from "@/lib/activity";
import { useToast } from "@/components/Toast";
import { reorderRows, reorderSubtasks, cleanupActivityLog, fireAndForget } from "@/lib/db-helpers";
import { Save, Upload, Calendar, Pencil, Trash2, AlertTriangle, Archive } from "lucide-react";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { ConfirmModal } from "@/components/ConfirmModal";
import { TaskFormModal } from "@/components/project/TaskFormModal";
import { TaskItem, TaskActions } from "@/components/project/TaskItem";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { fetchProjectById, fetchProjectTasksWithSubs } from "@/lib/queries";

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { toast } = useToast();
  const { userId } = useCurrentUser();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);

  // Which periods each recurring task has been completed in. Keyed by task id;
  // see lib/recurrence.ts. Empty for non-recurring tasks, which still use
  // `progress` as before.
  const [taskChecks, setTaskChecks] = useState<TaskCheckMap>({});

  // Hour scheduler (migration v24). The picker is opened from a task's menu;
  // the block itself lives on the task's planner occurrence.
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);

  // Timer
  const [elapsed, setElapsed] = useState<Record<string, number>>({});

  // UI
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"task" | "subtask" | "info">("task");
  const [editTarget, setEditTarget] = useState<ProjectTask | Subtask | null>(null);
  const [parentTaskId, setParentTaskId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formEst, setFormEst] = useState(0);
  const [formDate, setFormDate] = useState(""); // when to do it → calendar
  const [formDeadline, setFormDeadline] = useState(""); // when it's due → deadlines
  const [formRecurrence, setFormRecurrence] = useState<string | null>(null);
  const [descModalOpen, setDescModalOpen] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [gcalModalOpen, setGcalModalOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragSubIdx, setDragSubIdx] = useState<number | null>(null);
  const [dragSubParent, setDragSubParent] = useState<string | null>(null);
  const [subMenuOpen, setSubMenuOpen] = useState<string | null>(null);
  const [moveSubModal, setMoveSubModal] = useState<{ subId: string; subName: string; fromTaskId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedTasks, setArchivedTasks] = useState<ProjectTask[]>([]);
  const [archivedSubs, setArchivedSubs] = useState<(Subtask & { project_tasks: { id: string; name: string } })[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [confirmAction, setConfirmAction] = useState<{ message: string; action: () => void } | null>(null);
  const loadIdRef = useRef(0);

  // Timer hook — DB-backed started_at, drift-proof
  const onElapsedChange = useCallback((timerId: string, value: number) => {
    setElapsed((prev) => ({ ...prev, [timerId]: value }));
  }, []);
  const onTaskAlarmUpdate = useCallback((taskId: string, updates: Partial<ProjectTask>) => {
    updateTaskLocal(taskId, updates);
  }, []);
  const { activeTaskId, stopTimer, toggleTimer } = useTimer({
    userId, projectId, tasks, onElapsedChange, onTaskUpdate: onTaskAlarmUpdate,
  });

  // Mirror of activeTaskId for use inside callbacks that must NOT re-create
  // themselves when a timer starts or stops.
  const activeTaskIdRef = useRef<string | null>(null);
  useEffect(() => { activeTaskIdRef.current = activeTaskId; }, [activeTaskId]);

  // Close menu on outside click
  useEffect(() => { document.title = project ? `Comfy Board — ${project.title}` : "Comfy Board — Project"; }, [project]);

  useEffect(() => {
    if (!menuOpen && !subMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-ctx-menu]")) return;
      setMenuOpen(null);
      setSubMenuOpen(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen, subMenuOpen]);

  const loadProject = useCallback(async () => {
    if (!userId) return;
    const thisLoad = ++loadIdRef.current;
    try {
      const supabase = createClient();

      const proj = await fetchProjectById(supabase, projectId);
      if (!proj) { router.push("/projects"); return; }
      if (loadIdRef.current !== thisLoad) return;
      setProject(proj);

      const tasksWithSubs = await fetchProjectTasksWithSubs(supabase, projectId);
      if (loadIdRef.current !== thisLoad) return;
      setTasks(tasksWithSubs);

      // Per-period completions for the repeating tasks only. One extra query,
      // skipped entirely when the project has no repeats.
      const recurringIds = tasksWithSubs.filter((t) => isRecurrence(t.recurrence)).map((t) => t.id);
      if (recurringIds.length > 0) {
        const checks = await fetchTaskChecks(supabase, userId, recurringIds);
        if (loadIdRef.current !== thisLoad) return;
        setTaskChecks(checks);
      } else {
        setTaskChecks({});
      }

      // Count archived tasks + subtasks
      Promise.all([
        supabase.from("project_tasks").select("*", { count: "exact", head: true })
          .eq("project_id", projectId).not("archived_at", "is", null),
        supabase.from("subtasks").select("*, project_tasks!inner(project_id)", { count: "exact", head: true })
          .not("archived_at", "is", null).eq("project_tasks.project_id", projectId)
          .is("project_tasks.archived_at", null),
      ]).then(([tasks, subs]) => setArchivedCount((tasks.count || 0) + (subs.count || 0)))
        .catch((err) => console.error("[project:archived-count]", err));

      const el: Record<string, number> = {};
      for (const t of tasksWithSubs) {
        el[t.id] = t.elapsed_seconds;
        for (const s of t.subtasks || []) el[`sub:${s.id}`] = s.elapsed_seconds || 0;
      }
      setElapsed((prev) => {
        const merged = { ...el };
        // Keep the live value for whichever timer is running. Read through a
        // ref, not the state value — depending on `activeTaskId` here made
        // every timer start/stop refetch the entire project.
        const running = activeTaskIdRef.current;
        if (running && prev[running] !== undefined) merged[running] = prev[running];
        return merged;
      });

      await cleanupActivityLog(supabase, userId);
    } catch (err) {
      console.error("Project load failed:", err);
      toast("Failed to load project", "error");
    }
  }, [projectId, router, userId, toast]);

  useEffect(() => { loadProject().catch((err) => console.error("[project:load]", err)); }, [loadProject]);

  // Listen for expand-task events from monitoring panel
  useEffect(() => {
    const handler = (e: Event) => {
      const taskId = (e as CustomEvent).detail;
      if (taskId) setExpandedTasks(prev => new Set(prev).add(taskId));
    };
    const moveHandler = () => loadProject();
    window.addEventListener("expand-task", handler);
    window.addEventListener("task-moved", moveHandler);

    // Refetch when a task is ticked somewhere else — the planner, the day
    // page, the dashboard. Without this the page keeps whatever it loaded on
    // mount, so a tick made in the calendar while this tab sat open looked
    // like it hadn't saved. See lib/task-events.ts.
    const changed = onTaskChanged(({ source }) => {
      if (source !== "project") {
        loadProject().catch((err) => console.error("[project:refetch]", err));
      }
    });

    return () => {
      window.removeEventListener("expand-task", handler);
      window.removeEventListener("task-moved", moveHandler);
      changed();
    };
  }, [loadProject]);

  // ── Granular state helpers (avoid full reload after mutations) ──

  const updateTaskLocal = (taskId: string, updates: Partial<ProjectTask>) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, ...updates } : t));
  };

  const updateSubtaskLocal = (taskId: string, subtaskId: string, updates: Partial<Subtask>) => {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).map((s) => s.id === subtaskId ? { ...s, ...updates } : s) };
    }));
  };

  const addTaskLocal = (task: ProjectTask) => {
    setTasks((prev) => [...prev, { ...task, subtasks: [] }]);
    setElapsed((prev) => ({ ...prev, [task.id]: task.elapsed_seconds || 0 }));
  };

  const removeTaskLocal = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setElapsed((prev) => { const copy = { ...prev }; delete copy[taskId]; return copy; });
  };

  const addSubtaskLocal = (taskId: string, subtask: Subtask) => {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: [...(t.subtasks || []), subtask] };
    }));
    setElapsed((prev) => ({ ...prev, [`sub:${subtask.id}`]: subtask.elapsed_seconds || 0 }));
  };

  const removeSubtaskLocal = (taskId: string, subtaskId: string) => {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).filter((s) => s.id !== subtaskId) };
    }));
  };

  const recalcParentProgress = (taskId: string) => {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== taskId || !t.subtasks?.length) return t;
      const avg = Math.round(t.subtasks.reduce((s, st) => s + st.progress, 0) / t.subtasks.length);
      return { ...t, progress: avg };
    }));
  };

  // Task CRUD
  const saveTaskModal = async () => {
    if (!formName.trim() || saving) return;
    setSaving(true);
    try {
    const supabase = createClient();
    const name = formName.trim();
    const deadline = formDeadline || null;  // → deadline dashboard (when it's due)

    // → calendar (when to work on it).
    //
    // A repeat needs a start date to generate occurrences from. The recurrence
    // control used to be hidden until you set one, so you couldn't reach it
    // without first discovering that rule. It is always visible now, and a
    // repeat with no date starts from today — otherwise the setting would save
    // correctly and still produce nothing on the calendar, which looks exactly
    // like it didn't save.
    const calDate = formDate || (modalMode === "task" && formRecurrence ? todayKey() : null);

    if (modalMode === "task") {
      if (editTarget && "project_id" in editTarget) {
        // Switching a finished one-off task to "repeats" has to clear its
        // progress in the same write. `progress` stops being its completion
        // state the moment it becomes recurring, and a stale 100 would leave
        // it looking permanently finished while the period checkbox says it
        // has never been done. (Migration v23 does this once, for tasks that
        // were already recurring; this is the same fix for the live path.)
        const wasDone = (editTarget as ProjectTask).progress >= 100;
        const resetProgress = formRecurrence && wasDone;

        const { error: upErr } = await supabase
          .from("project_tasks")
          .update({
            name, est_minutes: formEst, deadline, date_key: calDate, recurrence: formRecurrence,
            ...(resetProgress ? { progress: 0 } : {}),
          })
          .eq("id", editTarget.id);

        if (upErr) {
          // Don't rebuild the planner/deadline mirrors from an edit the
          // database rejected — that leaves the two permanently disagreeing.
          toast("Failed to save task: " + upErr.message, "error");
          return;
        }

        updateTaskLocal(editTarget.id, {
          name, est_minutes: formEst, deadline, date_key: calDate, recurrence: formRecurrence,
          ...(resetProgress ? { progress: 0 } : {}),
        });

        if (project) {
          await syncProjectTaskToWeek(supabase, userId, editTarget.id, name, projectId, project.title, calDate, (editTarget).date_key, formRecurrence);
          await syncTaskDeadlineToDeadlines(supabase, userId, editTarget.id, name, project.title, deadline, formRecurrence);

          // Rebuilding the occurrences restores `done` by matching the OLD
          // date, so moving a repeat to a different day would drop the tick
          // for a period already completed. Rebuild the mirror from the
          // checks, which are the source of truth.
          if (isRecurrence(formRecurrence)) {
            await reconcileRecurringMirror(supabase, userId, editTarget.id, formRecurrence);
          }
        }
      } else {
        const { data: newTask, error: insErr } = await supabase.from("project_tasks").insert({
          project_id: projectId, user_id: userId, name,
          est_minutes: formEst, deadline, date_key: calDate, sort_order: tasks.length,
          recurrence: formRecurrence,
        }).select().single();

        if (insErr) {
          toast("Failed to add task: " + insErr.message, "error");
          return;
        }

        if (newTask && project) {
          addTaskLocal(newTask as ProjectTask);
          if (calDate) {
            await syncProjectTaskToWeek(supabase, userId, newTask.id, name, projectId, project.title, calDate, null, formRecurrence);
          }
          if (deadline) {
            await syncTaskDeadlineToDeadlines(supabase, userId, newTask.id, name, project.title, deadline, formRecurrence);
          }
        }
      }
    } else if (modalMode === "subtask" && parentTaskId) {
      const parent = tasks.find((t) => t.id === parentTaskId);
      let subtaskId: string | null = null;

      if (editTarget && "task_id" in editTarget) {
        await supabase
          .from("subtasks")
          .update({ name, est_minutes: formEst, deadline, date_key: calDate, recurrence: formRecurrence })
          .eq("id", editTarget.id);
        updateSubtaskLocal(parentTaskId, editTarget.id, { name, est_minutes: formEst, deadline, date_key: calDate, recurrence: formRecurrence });
        subtaskId = editTarget.id;
        // Recalc parent est_minutes
        if (parent?.subtasks) {
          const subs = parent.subtasks.map((s) => s.id === editTarget.id ? { ...s, est_minutes: formEst } : s);
          const totalEst = subs.reduce((s, st) => s + st.est_minutes, 0);
          await supabase.from("project_tasks").update({ est_minutes: totalEst }).eq("id", parentTaskId);
          updateTaskLocal(parentTaskId, { est_minutes: totalEst });
        }
      } else {
        const { data: newSub } = await supabase.from("subtasks").insert({
          task_id: parentTaskId, user_id: userId, name,
          est_minutes: formEst, deadline, date_key: calDate,
          recurrence: formRecurrence,
          sort_order: (parent?.subtasks?.length || 0),
        }).select().single();
        if (newSub) {
          addSubtaskLocal(parentTaskId, newSub as Subtask);
          subtaskId = (newSub as Subtask).id;
          // Recalc parent progress and est_minutes to account for new subtask
          const allSubs = [...(parent?.subtasks || []), newSub as Subtask];
          const avg = Math.round(allSubs.reduce((s, st) => s + st.progress, 0) / allSubs.length);
          const totalEst = allSubs.reduce((s, st) => s + st.est_minutes, 0);
          await supabase.from("project_tasks").update({ progress: avg, est_minutes: totalEst }).eq("id", parentTaskId);
          updateTaskLocal(parentTaskId, { progress: avg, est_minutes: totalEst });
        }
      }

      // Sync subtask to calendar via subtask_id (proper FK — not text matching)
      if (project && parent && subtaskId) {
        await syncSubtaskToWeek(supabase, userId, subtaskId, parentTaskId, name, projectId, project.title, calDate);
      }
    }

    setModalOpen(false);
    setFormDate("");
    setFormDeadline("");
    setFormRecurrence(null);
    if (modalMode === "subtask" && parentTaskId) {
      setExpandedTasks((prev) => new Set(prev).add(parentTaskId));
    }
    if (!editTarget) {
      const supabase2 = createClient();
      await logActivity(supabase2, userId, projectId,
        modalMode === "task" ? "Task added" : "Subtask added", formName.trim());
    }
    } finally {
      setSaving(false);
    }
  };

  const removeTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (activeTaskId === taskId) await stopTimer();
    setMenuOpen(null);
    // Optimistic: remove from UI immediately
    removeTaskLocal(taskId);

    // Fire DB cleanup in background.
    // removeTaskMirrors clears BOTH week_tasks and deadlines — deleting only the
    // planner rows used to leave an undeletable countdown behind on /deadlines.
    const supabase = createClient();
    (async () => {
      // Must run BEFORE the delete: week_tasks.project_task_id is
      // ON DELETE SET NULL, so if the delete lands first the mirror rows are
      // detached and the cleanup matches nothing, orphaning them permanently.
      await removeTaskMirrors(supabase, userId, taskId);
      await Promise.all([
        supabase.from("project_tasks").delete().eq("id", taskId),
        logActivity(supabase, userId, projectId, "Task removed", task?.name || ""),
      ]);
    })().catch((err) => console.error("[task:remove]", err));
  };

  const removeSubtask = (subtaskId: string, parentId: string) => {
    setConfirmAction({
      message: "Remove this subtask?",
      action: () => {
        removeSubtaskLocal(parentId, subtaskId);
        const parent = tasks.find((t) => t.id === parentId);
        const remaining = (parent?.subtasks || []).filter((s) => s.id !== subtaskId);
        const supabase = createClient();
        if (remaining.length > 0) {
          const avg = Math.round(remaining.reduce((s, st) => s + st.progress, 0) / remaining.length);
          const totalEst = remaining.reduce((s, st) => s + st.est_minutes, 0);
          updateTaskLocal(parentId, { progress: avg, est_minutes: totalEst });
          Promise.all([
            supabase.from("subtasks").delete().eq("id", subtaskId),
            supabase.from("project_tasks").update({ progress: avg, est_minutes: totalEst }).eq("id", parentId),
          ]).catch((err) => console.error("[subtask:remove]", err));
        } else {
          updateTaskLocal(parentId, { est_minutes: 0 });
          Promise.all([
            supabase.from("subtasks").delete().eq("id", subtaskId),
            supabase.from("project_tasks").update({ est_minutes: 0 }).eq("id", parentId),
          ]).catch((err) => console.error("[subtask:remove]", err));
        }
      },
    });
  };

  // Subtask drag-drop reorder
  const handleSubDragStart = (parentId: string, idx: number) => {
    setDragSubParent(parentId);
    setDragSubIdx(idx);
  };
  const handleSubDragOver = (e: React.DragEvent, parentId: string, idx: number) => {
    e.preventDefault();
    if (dragSubIdx === null || dragSubParent !== parentId || dragSubIdx === idx) return;
    const task = tasks.find((t) => t.id === parentId);
    if (!task?.subtasks) return;
    const newSubs = [...task.subtasks];
    const [moved] = newSubs.splice(dragSubIdx, 1);
    newSubs.splice(idx, 0, moved);
    setTasks((prev) => prev.map((t) => t.id === parentId ? { ...t, subtasks: newSubs } : t));
    setDragSubIdx(idx);
  };
  const handleSubDragEnd = async (parentId: string) => {
    setDragSubIdx(null);
    setDragSubParent(null);
    const task = tasks.find((t) => t.id === parentId);
    if (!task?.subtasks || !userId) return;
    const supabase = createClient();
    const { error } = await reorderSubtasks(supabase, task.subtasks.map((s) => s.id), userId);
    if (error) toast("Failed to reorder: " + error, "error");
  };

  // Move subtask to another task
  const moveSubtask = async (subtaskId: string, fromTaskId: string, toTaskId: string) => {
    const supabase = createClient();
    const fromParent = tasks.find((t) => t.id === fromTaskId);
    const movedSub = fromParent?.subtasks?.find((s) => s.id === subtaskId);
    const toTask = tasks.find((t) => t.id === toTaskId);
    const newOrder = (toTask?.subtasks?.length || 0);
    await supabase.from("subtasks").update({ task_id: toTaskId, sort_order: newOrder }).eq("id", subtaskId);

    // Granular: remove from source, add to target
    removeSubtaskLocal(fromTaskId, subtaskId);
    if (movedSub) {
      addSubtaskLocal(toTaskId, { ...movedSub, task_id: toTaskId, sort_order: newOrder });
    }

    // Recalc source parent progress
    const remaining = (fromParent?.subtasks || []).filter((s) => s.id !== subtaskId);
    if (remaining.length > 0) {
      const avg = Math.round(remaining.reduce((s, st) => s + st.progress, 0) / remaining.length);
      await supabase.from("project_tasks").update({ progress: avg }).eq("id", fromTaskId);
      updateTaskLocal(fromTaskId, { progress: avg });
    }
    setMoveSubModal(null);
    toast("Subtask moved", "success");
  };

  const updateTaskField = async (taskId: string, field: string, value: string | number | null) => {
    // Optimistic: update UI immediately
    updateTaskLocal(taskId, { [field]: value });
    const task = tasks.find((t) => t.id === taskId);

    const supabase = createClient();

    // Fire DB update + syncs in parallel, don't block UI
    const dbUpdate = supabase.from("project_tasks").update({ [field]: value }).eq("id", taskId)
      .then(({ error }) => { if (error) toast("Failed to save: " + error.message, "error"); });

    // Fire syncs in background — don't await
    if (field === "deadline" && task && project) {
      syncTaskDeadlineToDeadlines(supabase, userId, taskId, task.name, project.title, value as string | null, task.recurrence)
        .then(r => { if (r.error) toast("Sync error: " + r.error, "error"); })
        .catch((err) => console.error("[sync:deadline]", err));
    }
    if (field === "date_key" && task && project) {
      // Pass the stored recurrence — omitting it used to rebuild a repeating
      // task as a single one-off occurrence.
      syncProjectTaskToWeek(supabase, userId, taskId, task.name, projectId, project.title, value as string | null, task.date_key, task.recurrence)
        .then(r => { if (r.error) toast("Sync error: " + r.error, "error"); })
        .catch((err) => console.error("[sync:week]", err));
    }
    if (field === "name" && task && project) {
      // Keep the planner text and deadline label in step with the rename.
      syncProjectTaskToWeek(supabase, userId, taskId, String(value), projectId, project.title, task.date_key, task.date_key, task.recurrence)
        .then(r => { if (r.error) toast("Sync error: " + r.error, "error"); })
        .catch((err) => console.error("[sync:week]", err));
      if (task.deadline) {
        syncTaskDeadlineToDeadlines(supabase, userId, taskId, String(value), project.title, task.deadline, task.recurrence)
          .then(r => { if (r.error) toast("Sync error: " + r.error, "error"); })
          .catch((err) => console.error("[sync:deadline]", err));
      }
    }
    if (field === "progress" && task) {
      syncTaskCompletion(supabase, userId, taskId, value as number)
        .then(r => { if (r.error) toast("Sync error: " + r.error, "error"); })
        .catch((err) => console.error("[sync:completion]", err));
    }

    await dbUpdate;
  };

  /**
   * Tick a repeating task for the period it is currently in.
   *
   * This is what replaces `progress = 100` for repeating tasks. Completion is
   * recorded against the period, so the task comes back unticked the moment
   * the next day / week / month / year starts — the "refresh" — and the
   * streak is the record of the ones before it.
   *
   * `setTaskCheck` also mirrors the tick onto the planner rows inside that
   * period, so ticking here and ticking on the calendar are the same action.
   */
  const toggleTaskCheck = async (taskId: string, period: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !isRecurrence(task.recurrence)) return;

    // `period` comes from the row that was clicked, not from `new Date()`
    // here. Recomputing would act on a different period from the one the
    // checkbox was showing if the page has been open across midnight.
    const wasChecked = taskChecks[taskId]?.has(period) ?? false;
    const next = !wasChecked;

    // Optimistic. Copy the Set — mutating the one in state would leave React
    // comparing an object to itself and skipping the render.
    setTaskChecks((prev) => {
      const set = new Set(prev[taskId] ?? []);
      if (next) set.add(period); else set.delete(period);
      return { ...prev, [taskId]: set };
    });

    const supabase = createClient();
    const { error } = await setTaskCheck(supabase, userId, taskId, task.recurrence, period, next);

    if (error) {
      toast("Failed to save: " + error, "error");
      setTaskChecks((prev) => {
        const set = new Set(prev[taskId] ?? []);
        if (next) set.delete(period); else set.add(period);
        return { ...prev, [taskId]: set };
      });
    }
  };

  /**
   * Open the hour picker for a task's planner occurrence.
   *
   * The block lives on `week_tasks`, not here — a time is a property of the
   * placement on a day, not of the task. So this has to find the occurrence
   * first. For a repeating task that means several candidates; the next one
   * from today is the one you almost always mean, falling back to the most
   * recent if the whole series is in the past.
   *
   * Only that one occurrence is scheduled. "Every standup at 09:00" would be
   * a different feature, and guessing at it here would silently rewrite days
   * the user never opened.
   */
  const scheduleTask = async (task: ProjectTask) => {
    if (!task.date_key) return;
    const supabase = createClient();

    const { data, error } = await supabase
      .from("week_tasks")
      .select("id, date_key, start_minute, end_minute")
      .eq("user_id", userId)
      .eq("project_task_id", task.id)
      .is("subtask_id", null)
      // Skip occurrences that have been rescheduled away. The planner leaves
      // the old row in place, greyed out, as the record that you moved it —
      // writing a time onto that row would set a time on a day nothing shows.
      .is("rescheduled_to", null)
      .order("date_key");

    if (error) { toast("Couldn't load the calendar entry: " + error.message, "error"); return; }

    const rows = (data || []) as Array<{ id: string; date_key: string; start_minute: number | null; end_minute: number | null }>;
    if (rows.length === 0) {
      toast("This task isn't on the calendar yet — set a date first.", "error");
      return;
    }

    const today = todayKey();
    const row = rows.find((r) => r.date_key >= today) ?? rows[rows.length - 1];

    // Everything else already on that day, so the suggested slot doesn't land
    // on top of something.
    const { data: sameDay } = await supabase
      .from("week_tasks")
      .select("id, start_minute, end_minute")
      .eq("user_id", userId)
      .eq("date_key", row.date_key)
      .not("start_minute", "is", null);

    setScheduleTarget({
      id: row.id,
      label: task.name,
      dateKey: row.date_key,
      estMinutes: task.est_minutes,
      current: row.start_minute !== null && row.end_minute !== null
        ? { start: row.start_minute, end: row.end_minute }
        : null,
      existing: ((sameDay || []) as Array<{ id: string; start_minute: number; end_minute: number }>)
        .filter((r) => r.id !== row.id)
        .map((r) => ({ start: r.start_minute, end: r.end_minute })),
    });
  };

  const saveScheduleBlock = async (weekTaskId: string, block: Block | null, newDate?: string) => {
    const supabase = createClient();

    // Changing the day is a reschedule: the old entry stays on its original
    // day marked as moved, so the planner still shows that it slipped.
    if (newDate) {
      const { data: row, error: readErr } = await supabase
        .from("week_tasks")
        .select("id, date_key, text, project_id, project_task_id, subtask_id, start_minute, end_minute")
        .eq("id", weekTaskId).maybeSingle();

      if (readErr || !row) {
        toast("Couldn't find the calendar entry to move.", "error");
        return;
      }

      const res = await rescheduleWeekTask(supabase, userId, {
        ...(row as {
          id: string; date_key: string; text: string;
          project_id: string | null; project_task_id: string | null; subtask_id: string | null;
        }),
        start_minute: block?.start ?? null,
        end_minute: block?.end ?? null,
      }, newDate);

      if (res.error) { toast("Couldn't move it: " + res.error, "error"); return; }
      toast(`Moved to ${newDate}`, "success");
      loadProject().catch((err) => console.error("[project:refetch]", err));
      return;
    }

    if (!block) return;
    const { error } = await supabase.from("week_tasks")
      .update({ start_minute: block.start, end_minute: block.end })
      .eq("id", weekTaskId);
    if (error) { toast("Couldn't save the time: " + error.message, "error"); return; }
    toast(`Scheduled ${describeBlock(block)}`, "success");
  };

  const clearScheduleBlock = async (weekTaskId: string) => {
    const supabase = createClient();
    // Both columns move together — the v24 CHECK constraint rejects a
    // half-cleared pair.
    const { error } = await supabase.from("week_tasks")
      .update({ start_minute: null, end_minute: null })
      .eq("id", weekTaskId);
    if (error) toast("Couldn't clear the time: " + error.message, "error");
  };

  const updateSubtaskField = async (subtaskId: string, parentId: string, field: string, value: string | number | null) => {
    const parent = tasks.find((t) => t.id === parentId);
    const sub = parent?.subtasks?.find((s) => s.id === subtaskId);
    const subName = sub?.name || "Subtask";

    // Optimistic: update UI immediately
    updateSubtaskLocal(parentId, subtaskId, { [field]: value });

    const supabase = createClient();

    const { error } = await supabase.from("subtasks").update({ [field]: value }).eq("id", subtaskId);
    if (error) {
      toast("Failed to save: " + error.message, "error");
      // Roll the optimistic edit back so the UI can't claim a save that failed.
      if (sub) updateSubtaskLocal(parentId, subtaskId, { [field]: sub[field as keyof Subtask] });
      return;
    }

    if (field === "name" && project) {
      // Propagate the rename to the mirrored planner rows and deadline label,
      // which are matched by text and would otherwise keep the old name forever.
      fireAndForget(
        Promise.resolve(
          syncSubtaskRename(supabase, userId, subtaskId, project.title, String(value), subName)
        ).then((r) => ({ error: r.error ? { message: r.error } : null })),
        "subtask:rename"
      );
    }

    if (field === "date_key" && project) {
      const r = await syncSubtaskToWeek(supabase, userId, subtaskId, parentId, subName, projectId, project.title, value as string | null);
      if (r.error) toast("Sync error: " + r.error, "error");
    }

    if (field === "deadline" && project) {
      const label = `[${project.title}] ↳ ${subName}`;
      // Keyed on subtask_id, not the label string: two subtasks with the same
      // name in one project used to delete each other's deadline.
      await supabase.from("deadlines").delete()
        .eq("user_id", userId).eq("source_subtask_id", subtaskId);
      if (value) {
        const { error: insErr } = await supabase.from("deadlines").insert({
          user_id: userId, label,
          target_datetime: deadlineTimestamp(value as string),
          source_subtask_id: subtaskId,
        });
        if (insErr) toast("Sync error: " + insErr.message, "error");
      }
    }

    if (field === "est_minutes" && parent?.subtasks) {
      const subs = parent.subtasks.map((s) => s.id === subtaskId ? { ...s, est_minutes: value as number } : s);
      const totalEst = subs.reduce((s, st) => s + st.est_minutes, 0);
      updateTaskLocal(parentId, { est_minutes: totalEst });
      fireAndForget(
        supabase.from("project_tasks").update({ est_minutes: totalEst }).eq("id", parentId),
        "subtask:est_rollup"
      );
    }

    if (field === "progress") {
      await syncSubtaskCompletion(supabase, userId, subtaskId, value as number);

      // Roll the new average up to the parent. This used to be issued from
      // inside a setTasks updater — it ran twice under StrictMode and, because
      // the query was never awaited, never actually reached the database.
      const result = await recalcParentFromSubtasks(supabase, userId, parentId);
      if (result.error) toast("Sync error: " + result.error, "error");
      if (result.progress !== undefined) {
        updateTaskLocal(parentId, { progress: result.progress });
      }
    }
  };

  const updateDescription = async () => {
    if (!project) return;
    const supabase = createClient();
    await supabase.from("projects").update({ description: descDraft }).eq("id", projectId);
    setProject({ ...project, description: descDraft });
    setDescModalOpen(false);
  };

  // Drag reorder
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const nt = [...tasks];
    const [moved] = nt.splice(dragIdx, 1);
    nt.splice(idx, 0, moved);
    setTasks(nt);
    setDragIdx(idx);
  };
  const handleDragEnd = async () => {
    setDragIdx(null);
    if (!userId) return;
    const supabase = createClient();
    const { error } = await reorderRows(supabase, "project_tasks", tasks.map((t) => t.id), userId);
    if (error) toast("Failed to reorder: " + error, "error");
  };

  // Calculations
  // If task has subtasks, its est_minutes = sum of subtask est (already rolled up in DB)
  // If task has no subtasks, use its own est_minutes
  const totalEst = tasks.reduce((s, t) => {
    if (t.subtasks && t.subtasks.length > 0) {
      return s + (t.subtasks || []).reduce((ss, sub) => ss + sub.est_minutes, 0);
    }
    return s + t.est_minutes;
  }, 0);
  const totalElapsed = tasks.reduce((s, t) => {
    const taskTime = elapsed[t.id] || t.elapsed_seconds;
    const subTime = (t.subtasks || []).reduce((ss, sub) => ss + (elapsed[`sub:${sub.id}`] || sub.elapsed_seconds), 0);
    return s + taskTime + subTime;
  }, 0);
  // Repeating tasks are excluded from the project's completion figure.
  //
  // They have no completion to contribute: under the per-period model their
  // `progress` stays at 0 forever, so counting them would peg the project
  // below 100% permanently — a project isn't half finished because it has a
  // daily upkeep task on it. (Under the OLD model they had the opposite
  // problem: ticked once, they read 100% forever and inflated the figure.)
  const countableTasks = tasks.filter((t) => !isRecurrence(t.recurrence));
  const overallProgress = countableTasks.length > 0
    ? Math.round(countableTasks.reduce((s, t) => s + t.progress, 0) / countableTasks.length)
    : 0;

  // Save as template
  const saveAsTemplate = async () => {
    const name = prompt("Template name:", project?.title || "");
    if (!name?.trim() || !project) return;
    const supabase = createClient();

    const taskData = tasks.map((t) => ({
      name: t.name,
      est_minutes: t.est_minutes,
      deadline: t.deadline,
      progress: 0,
      notes: t.notes,
      subtasks: (t.subtasks || []).map((s) => ({
        name: s.name,
        est_minutes: s.est_minutes,
        deadline: s.deadline,
        progress: 0,
        notes: s.notes,
      })),
      elapsed_seconds: 0,
    }));

    await supabase.from("templates").insert({
      user_id: userId,
      name: name.trim(),
      task_data: taskData,
    });

    alert("Template saved!");
  };

  // Export project as JSON
  const exportProject = () => {
    if (!project) return;
    const data = {
      id: project.id,
      title: project.title,
      description: project.description,
      est_minutes: totalEst,
      elapsed_seconds: project.elapsed_seconds,
      active_task: project.active_task_id,
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        est_minutes: t.est_minutes,
        deadline: t.deadline,
        progress: t.progress,
        notes: t.notes,
        elapsed_seconds: t.elapsed_seconds,
        file_url: t.file_url,
        file_name: t.file_name,
        subtasks: (t.subtasks || []).map((s) => ({
          id: s.id,
          name: s.name,
          est_minutes: s.est_minutes,
          deadline: s.deadline,
          progress: s.progress,
          notes: s.notes,
          file_url: s.file_url,
          file_name: s.file_name,
        })),
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.title.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportProjectCSV = () => {
    if (!project) return;
    const rows: string[][] = [["Type", "Name", "Est Minutes", "Deadline", "Date", "Progress", "Notes", "Parent Task"]];
    for (const t of tasks) {
      rows.push(["task", t.name, String(t.est_minutes), t.deadline || "", t.date_key || "", String(t.progress), t.notes || "", ""]);
      for (const s of t.subtasks || []) {
        rows.push(["subtask", s.name, String(s.est_minutes), s.deadline || "", s.date_key || "", String(s.progress), s.notes || "", t.name]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.title.replace(/[^a-zA-Z0-9]/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helper to open the edit modal for tasks or subtasks
  const openEditModal = (target: ProjectTask | Subtask | null, mode: "task" | "subtask", parentId?: string) => {
    setEditTarget(target);
    setParentTaskId(parentId || null);
    setFormName(target ? target.name : "");
    setFormEst(target ? target.est_minutes : 0);
    setFormDate(target ? ((target as ProjectTask).date_key || "") : "");
    setFormDeadline(target ? (target.deadline || "") : "");
    // Load the saved recurrence so re-opening Edit doesn't silently clear it
    // (which used to collapse a repeating task down to a single occurrence).
    setFormRecurrence(target ? (target as ProjectTask | Subtask).recurrence ?? null : null);
    setModalMode(mode);
    setModalOpen(true);
  };

  const archiveTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    setTasks(prev => prev.filter(t => t.id !== taskId));
    const supabase = createClient();

    const { error } = await supabase
      .from("project_tasks")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", taskId);

    if (error) {
      // Put it back rather than letting it silently reappear on reload.
      setTasks(prev => [...prev, task].sort((a, b) => a.sort_order - b.sort_order));
      toast("Failed to archive: " + error.message, "error");
      return;
    }

    // An archived task must also leave the planner and the deadlines page,
    // otherwise it lingers there with no way to reach it.
    await removeTaskMirrors(supabase, userId, taskId);
    setArchivedCount((c) => c + 1);
    toast(`"${task.name}" archived`, "success");
  };

  const archiveSubtask = async (subId: string, parentId: string) => {
    const parent = tasks.find(t => t.id === parentId);
    const sub = parent?.subtasks?.find(s => s.id === subId);
    if (!sub) return;

    setTasks(prev => prev.map(t => {
      if (t.id !== parentId) return t;
      const remaining = (t.subtasks || []).filter(s => s.id !== subId);
      const avg = remaining.length > 0
        ? Math.round(remaining.reduce((s, st) => s + st.progress, 0) / remaining.length)
        : t.progress;
      const totalEst = remaining.reduce((s, st) => s + st.est_minutes, 0);
      return { ...t, subtasks: remaining, progress: avg, est_minutes: totalEst };
    }));

    const supabase = createClient();
    const { error } = await supabase
      .from("subtasks")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", subId);

    if (error) {
      await loadProject();
      toast("Failed to archive subtask: " + error.message, "error");
      return;
    }

    const remaining = (parent?.subtasks || []).filter(s => s.id !== subId);
    if (remaining.length > 0) {
      const avg = Math.round(remaining.reduce((s, st) => s + st.progress, 0) / remaining.length);
      const totalEst = remaining.reduce((s, st) => s + st.est_minutes, 0);
      await supabase.from("project_tasks").update({ progress: avg, est_minutes: totalEst }).eq("id", parentId);
    }

    await removeTaskMirrors(supabase, userId, parentId, subId);
    setArchivedCount(c => c + 1);
    toast(`"${sub.name}" archived`, "success");
  };

  const monitorTask = async (taskId: string, taskName: string, isSubtask?: boolean, subtaskId?: string) => {
    const supabase = createClient();
    const table = isSubtask ? "subtasks" : "project_tasks";
    const id = isSubtask ? subtaskId! : taskId;

    // Check if already monitored — toggle off
    const { data: existing } = await supabase.from("monitored_tasks")
      .select("id").eq("user_id", userId)
      .eq(isSubtask ? "subtask_id" : "task_id", id).limit(1).maybeSingle();

    if (existing) {
      await Promise.all([
        supabase.from("monitored_tasks").delete().eq("id", existing.id),
        supabase.from(table).update({ monitoring: false }).eq("id", id),
      ]);
      window.dispatchEvent(new Event("monitoring-changed"));
      if (isSubtask) {
        const parentTask = tasks.find(t => t.subtasks?.some(s => s.id === id));
        if (parentTask) updateSubtaskLocal(parentTask.id, id, { monitoring: false });
      } else {
        updateTaskLocal(taskId, { monitoring: false });
      }
      toast("Removed from monitoring", "info");
    } else {
      await supabase.from("monitored_tasks").insert({
        user_id: userId, project_id: projectId, task_id: taskId,
        subtask_id: isSubtask ? subtaskId : null,
        project_title: project?.title || "", task_name: taskName,
      });
      await supabase.from(table).update({ monitoring: true }).eq("id", id);
      if (isSubtask) {
        const parentTask = tasks.find(t => t.subtasks?.some(s => s.id === id));
        if (parentTask) updateSubtaskLocal(parentTask.id, id, { monitoring: true });
      } else {
        updateTaskLocal(taskId, { monitoring: true });
      }
      window.dispatchEvent(new Event("monitoring-changed"));
      toast("Added to monitoring", "success");
    }
  };

  const duplicateSubtask = async (sub: Subtask, parentTaskId: string) => {
    const supabase = createClient();
    const parent = tasks.find(t => t.id === parentTaskId);
    const newSortOrder = (parent?.subtasks?.length || 0);
    const { data } = await supabase.from("subtasks").insert({
      user_id: userId, task_id: parentTaskId,
      name: `${sub.name} (copy)`, est_minutes: sub.est_minutes,
      deadline: sub.deadline, date_key: sub.date_key,
      progress: 0, notes: sub.notes, sort_order: newSortOrder,
      elapsed_seconds: 0,
    }).select().single();
    if (data) {
      const newSub = data as Subtask;
      setTasks(prev => prev.map(t => t.id === parentTaskId
        ? { ...t, subtasks: [...(t.subtasks || []), newSub] } : t));
      toast("Subtask duplicated", "success");
    }
  };

  const taskActions: TaskActions = {
    toggleTimer, removeTask, removeSubtask,
    updateTaskField, updateSubtaskField,
    updateTaskLocal, updateSubtaskLocal,
    openEditModal, setExpandedTasks, setMoveSubModal,
    handleSubDragStart, handleSubDragOver, handleSubDragEnd,
    archiveTask, archiveSubtask, monitorTask, duplicateSubtask,
    toggleTaskCheck, scheduleTask,
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-red-acc border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <ColorPicker
                value={project.color || "#e05555"}
                onChange={async (c) => {
                  const supabase = createClient();
                  await supabase.from("projects").update({ color: c }).eq("id", projectId);
                  setProject({ ...project, color: c });
                  window.dispatchEvent(new Event("projects-changed"));
                }}
              />
              <InlineEdit
                value={project.title}
                onSave={async (v) => {
                  if (!v.trim()) return;
                  const supabase = createClient();
                  await supabase.from("projects").update({ title: v.trim() }).eq("id", projectId);
                  setProject({ ...project, title: v.trim() });
                  window.dispatchEvent(new Event("projects-changed"));
                }}
                className="font-title text-2xl text-bright"
                placeholder="Project title"
              />
            </div>
            <div className="mt-1 flex items-center gap-3 flex-wrap">
              <CalendarPicker
                value={project.start_date || null}
                variant="date"
                onChange={async (d) => {
                  const supabase = createClient();
                  await supabase.from("projects").update({ start_date: d }).eq("id", projectId);
                  setProject({ ...project, start_date: d });
                }}
              />
              {project.start_date && <span className="text-[10px] text-txt3">Start: {project.start_date}</span>}
              <CalendarPicker
                value={project.deadline || null}
                variant="deadline"
                onChange={async (d) => {
                  const supabase = createClient();
                  await supabase.from("projects").update({ deadline: d }).eq("id", projectId);
                  setProject({ ...project, deadline: d });
                }}
              />
              {project.deadline && (() => {
                const diff = new Date(project.deadline + "T23:59:00").getTime() - Date.now();
                const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
                const color = days < 0 ? "#5c5a7a" : days <= 3 ? "#f43f5e" : days <= 7 ? "#f59e0b" : "#4caf50";
                return <span className="text-xs font-mono" style={{ color }}>
                  {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`}
                </span>;
              })()}
            </div>
            <div className="mt-1">
              <InlineEdit
                value={project.description}
                onSave={async (v) => {
                  const supabase = createClient();
                  await supabase.from("projects").update({ description: v }).eq("id", projectId);
                  setProject({ ...project, description: v });
                }}
                type="textarea"
                className="text-sm text-txt3"
                placeholder="Click to add a description..."
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0 mt-1">
            {/* Primary actions */}
            <button
              onClick={() => { setDescDraft(project.description || ""); setDescModalOpen(true); }}
              className="text-xs text-txt3 hover:text-txt transition-colors"
            >
              <span className="flex items-center gap-1"><Pencil size={12} /> Edit description</span>
            </button>
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              className="text-xs text-txt3 hover:text-danger transition-colors"
            >
              <span className="flex items-center gap-1"><Trash2 size={12} /> Delete</span>
            </button>

            <div className="w-px h-4 bg-border mx-1" />

            {/* Secondary: exports — icon-only with tooltips */}
            <button onClick={saveAsTemplate} title="Save as template"
              className="w-7 h-7 rounded-md flex items-center justify-center text-txt3 hover:text-txt hover:bg-surface2 transition-colors">
              <Save size={13} />
            </button>
            <button onClick={exportProject} title="Export JSON"
              className="w-7 h-7 rounded-md flex items-center justify-center text-txt3 hover:text-txt hover:bg-surface2 transition-colors">
              <Upload size={13} />
            </button>
            <button onClick={exportProjectCSV} title="Export CSV"
              className="w-7 h-7 rounded-md flex items-center justify-center text-txt3 hover:text-txt hover:bg-surface2 transition-colors text-[10px] font-mono font-bold">
              CSV
            </button>
            <button onClick={() => setGcalModalOpen(true)} title="Sync to Google Calendar"
              className="w-7 h-7 rounded-md flex items-center justify-center text-txt3 hover:text-amber hover:bg-amber/10 transition-colors">
              <Calendar size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Timer bar */}
      {(() => {
        const totalEstSec = totalEst * 60;
        const isOvertime = totalEstSec > 0 && totalElapsed > totalEstSec;
        const overtimeSec = isOvertime ? totalElapsed - totalEstSec : 0;
        const pctUsed = totalEstSec > 0 ? Math.min(100, (totalElapsed / totalEstSec) * 100) : 0;

        return (
          <div className={`flex flex-wrap items-center gap-4 mb-4 bg-surface border rounded-lg px-4 py-3 text-sm ${
            isOvertime ? "border-danger/50" : "border-border"
          }`}>
            <div>
              <span className="text-txt3">Estimated: </span>
              <span className="text-bright font-mono">{formatMinutes(totalEst)}</span>
            </div>
            <div className="w-px h-4 bg-border" />
            <div>
              <span className="text-txt3">Tracked: </span>
              <span className={`font-mono ${isOvertime ? "text-danger" : "text-red-acc"}`}>
                {formatSeconds(totalElapsed)}
              </span>
              {totalEstSec > 0 && (
                <span className="text-txt3 ml-1 text-xs">({Math.round(pctUsed)}%)</span>
              )}
            </div>
            {isOvertime && (
              <>
                <div className="w-px h-4 bg-border" />
                <div>
                  <span className="text-danger font-medium inline-flex items-center gap-1">
                    <AlertTriangle size={13} /> Overtime: +{formatSeconds(overtimeSec)}
                  </span>
                </div>
              </>
            )}
            <div className="w-px h-4 bg-border" />
            <div>
              <span className="text-txt3">Status: </span>
              <span className={activeTaskId ? "text-green-acc" : "text-txt3"}>
                {activeTaskId ? "⏱ Running" : "● Stopped"}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Progress. Hidden when every task is a repeat — there is nothing to
          be a percentage of, and a permanent "0%" reads as failure. */}
      {countableTasks.length > 0 && (
        <div className="mb-6">
          <ProgressBar value={overallProgress} showLabel label="Overall Progress" height={10} />
        </div>
      )}

      {/* Add task — at top */}
      <button
        onClick={() => openEditModal(null, "task")}
        className="w-full bg-surface border border-dashed border-border2 rounded-lg px-4 py-2.5 text-sm text-txt3 hover:border-violet hover:text-violet transition-colors mb-3"
      >
        ＋ Add Task
      </button>

      {/* Task list */}
      <div className="space-y-2 mb-4">
        {tasks.map((task, idx) => (
          <TaskItem
            key={task.id}
            task={task}
            project={{ id: projectId, title: project.title }}
            idx={idx}
            activeTaskId={activeTaskId}
            elapsed={elapsed}
            isExpanded={expandedTasks.has(task.id)}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            subMenuOpen={subMenuOpen}
            setSubMenuOpen={setSubMenuOpen}
            dragSubIdx={dragSubIdx}
            dragSubParent={dragSubParent}
            userId={userId}
            checkedPeriods={taskChecks[task.id]}
            actions={taskActions}
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
          />
        ))}

        {tasks.length === 0 && (
          <div className="text-center py-12 text-txt3">
            <p className="text-lg mb-2">No tasks yet</p>
            <p className="text-sm">Add tasks to track your project progress</p>
          </div>
        )}
      </div>

      {/* Archived tasks */}
      <div className="mb-4">
        <button onClick={async () => {
          if (showArchived) { setShowArchived(false); return; }
          const supabase = createClient();
          const [taskRes, subRes] = await Promise.all([
            supabase.from("project_tasks")
              .select("*, subtasks(*)").eq("project_id", projectId).not("archived_at", "is", null)
              .order("archived_at", { ascending: false }),
            supabase.from("subtasks")
              .select("*, project_tasks!inner(id, name, project_id)")
              .not("archived_at", "is", null)
              .eq("project_tasks.project_id", projectId)
              .is("project_tasks.archived_at", null)
              .order("archived_at", { ascending: false }),
          ]);
          setArchivedTasks((taskRes.data || []) as ProjectTask[]);
          setArchivedSubs((subRes.data || []) as (Subtask & { project_tasks: { id: string; name: string } })[]);
          setShowArchived(true);
        }}
          className="text-xs text-txt3 hover:text-txt transition-colors flex items-center gap-1.5">
          <Archive size={12} />
          {showArchived ? "Hide archived" : "Show archived tasks"}
          {archivedCount > 0 && <span className="text-[10px] font-mono bg-surface3 px-1.5 py-0.5 rounded">({archivedCount})</span>}
        </button>

        {showArchived && (
          <div className="mt-3 border border-border rounded-xl bg-surface/50 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-surface2/30 flex items-center justify-between">
              <span className="text-xs font-medium text-txt2">Archived Tasks</span>
              <span className="text-[10px] text-txt3">{archivedTasks.length} task{archivedTasks.length !== 1 ? "s" : ""}</span>
            </div>

            {archivedTasks.length === 0 && archivedSubs.length === 0 ? (
              <div className="px-4 py-8 text-center text-txt3 text-xs">No archived items in this project</div>
            ) : (
              <div className="divide-y divide-border">
                {archivedSubs.length > 0 && (
                  <div className="px-4 py-3">
                    <div className="text-[10px] font-medium text-txt3 uppercase tracking-wide mb-2">Archived subtasks</div>
                    <div className="space-y-2">
                      {archivedSubs.map(sub => (
                        <div key={sub.id} className="flex items-center gap-2">
                          <span className="text-[10px] text-txt3 opacity-60">↳</span>
                          <span className="text-sm text-txt2 flex-1 min-w-0 truncate">{sub.name}</span>
                          <span className="text-[10px] text-txt3 shrink-0">from {sub.project_tasks.name}</span>
                          {sub.archived_at && <span className="text-[10px] text-txt3 shrink-0">{new Date(sub.archived_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                          <button onClick={async () => {
                            const supabase = createClient();
                            await supabase.from("subtasks").update({ archived_at: null }).eq("id", sub.id);
                            setArchivedSubs(prev => prev.filter(s => s.id !== sub.id));
                            setArchivedCount(c => c - 1);
                            await loadProject();
                            toast("Subtask restored", "success");
                          }} className="text-xs text-violet2 hover:text-violet px-2 py-1 rounded hover:bg-violet/10 transition-colors shrink-0">
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {archivedTasks.map(task => (
                  <div key={task.id} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm text-txt2 flex-1">{task.name}</span>
                      <button onClick={async () => {
                        const supabase = createClient();
                        await supabase.from("project_tasks").update({ archived_at: null }).eq("id", task.id);
                        setArchivedTasks(prev => prev.filter(t => t.id !== task.id));
                        setArchivedCount(c => c - 1);
                        await loadProject();
                        toast("Task restored", "success");
                      }} className="text-xs text-violet2 hover:text-violet px-2 py-1 rounded hover:bg-violet/10 transition-colors">
                        Restore
                      </button>
                      <button onClick={() => {
                        setConfirmAction({
                          message: `Permanently delete "${task.name}"?`,
                          action: async () => {
                            const supabase = createClient();
                            await supabase.from("project_tasks").delete().eq("id", task.id);
                            setArchivedTasks(prev => prev.filter(t => t.id !== task.id));
                            setArchivedCount(c => c - 1);
                            toast("Task deleted", "info");
                          },
                        });
                      }} className="text-xs text-txt3 hover:text-danger px-2 py-1 rounded hover:bg-danger/10 transition-colors">
                        Delete
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-txt3">
                      {task.est_minutes > 0 && <span>{Math.floor(task.est_minutes / 60)}h{task.est_minutes % 60 > 0 ? ` ${task.est_minutes % 60}m` : ""}</span>}
                      {task.elapsed_seconds > 0 && <span>Tracked: {formatSeconds(task.elapsed_seconds)}</span>}
                      {task.deadline && <span>Deadline: {task.deadline}</span>}
                      {task.date_key && <span>Date: {task.date_key}</span>}
                      <span>{task.progress}% done</span>
                      {task.archived_at && <span>Archived {new Date(task.archived_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                    </div>
                    {task.subtasks && task.subtasks.length > 0 && (
                      <div className="mt-2 ml-3 space-y-1">
                        {task.subtasks.map(sub => (
                          <div key={sub.id} className="flex items-center gap-2 text-[10px] text-txt3">
                            <span className={sub.progress >= 100 ? "line-through opacity-50" : ""}>{sub.progress >= 100 ? "✓" : "○"}</span>
                            <span className={cn("flex-1 truncate", sub.progress >= 100 && "line-through opacity-50")}>{sub.name}</span>
                            {sub.est_minutes > 0 && <span>{sub.est_minutes}m</span>}
                            {sub.elapsed_seconds > 0 && <span>{formatSeconds(sub.elapsed_seconds)}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Task/Subtask Modal */}
      <TaskFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={modalMode === "task" ? "task" : "subtask"}
        isEdit={!!editTarget}
        formName={formName}
        setFormName={setFormName}
        formEst={formEst}
        setFormEst={setFormEst}
        formDate={formDate}
        setFormDate={setFormDate}
        formDeadline={formDeadline}
        setFormDeadline={setFormDeadline}
        formRecurrence={formRecurrence}
        setFormRecurrence={setFormRecurrence}
        saving={saving}
        onSave={saveTaskModal}
      />

      {/* Description Modal */}
      <Modal
        open={descModalOpen}
        onClose={() => setDescModalOpen(false)}
        title="Project Description"
      >
        <div className="space-y-4">
          <textarea
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            className="w-full glass-field px-3 py-2 text-txt text-sm h-32 resize-none"
            placeholder="Add a description..."
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDescModalOpen(false)}
              className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3"
            >
              Cancel
            </button>
            <button
              onClick={updateDescription}
              className="px-4 py-2 rounded-lg text-sm bg-red-acc hover:bg-red-dark text-white"
            >
              Save
            </button>
          </div>
        </div>
      </Modal>

      {/* GCal Sync Modal */}
      <GCalSyncModal
        open={gcalModalOpen}
        onClose={() => setGcalModalOpen(false)}
        projectTitle={project.title}
        tasks={tasks}
      />

      {/* Move Subtask Modal */}
      {moveSubModal && (
        <Modal open={true} onClose={() => setMoveSubModal(null)} title={`Move "${moveSubModal.subName}"`}>
          <div className="space-y-2">
            <p className="text-sm text-txt2 mb-3">Select the target task:</p>
            {tasks.filter((t) => t.id !== moveSubModal.fromTaskId).map((t) => (
              <button key={t.id} onClick={() => moveSubtask(moveSubModal.subId, moveSubModal.fromTaskId, t.id)}
                className="glass-field w-full text-left px-3 py-2.5 text-sm text-txt hover:border-violet/50 hover:text-violet2 transition-colors">
                {t.name}
                <span className="text-[10px] text-txt3 ml-2">{t.subtasks?.length || 0} subtasks</span>
              </button>
            ))}
            {tasks.filter((t) => t.id !== moveSubModal.fromTaskId).length === 0 && (
              <p className="text-sm text-txt3 text-center py-4">No other tasks to move to</p>
            )}
          </div>
        </Modal>
      )}

      <ScheduleModal
        target={scheduleTarget}
        isToday={scheduleTarget?.dateKey === todayKey()}
        onClose={() => setScheduleTarget(null)}
        onSave={saveScheduleBlock}
        onClear={clearScheduleBlock}
      />

      {/* Confirm Delete Project */}
      <ConfirmDeleteModal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          setSaving(true);
          const supabase = createClient();
          const { error } = await supabase.from("projects")
            .update({ archived_at: new Date().toISOString() })
            .eq("id", projectId);
          if (error) {
            toast("Failed to delete project: " + error.message, "error");
            setSaving(false);
            return;
          }
          window.dispatchEvent(new Event("projects-changed"));
          router.push("/projects");
        }}
        title={`Delete "${project.title}"?`}
        confirmText={project.title}
        description="This will remove the project from all views. The data is preserved and can be recovered if needed."
        loading={saving}
      />

      <ConfirmModal
        open={!!confirmAction}
        message={confirmAction?.message || ""}
        danger
        confirmLabel="Remove"
        onConfirm={() => { confirmAction?.action(); }}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
}
