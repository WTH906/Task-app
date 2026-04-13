"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Project, ProjectTask, Subtask } from "@/lib/types";
import { formatSeconds, formatMinutes, progressColor, cn, playAlarm } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import { InlineEdit } from "@/components/InlineEdit";
import { CalendarPicker } from "@/components/CalendarPicker";
import { Modal } from "@/components/Modal";
import { syncProjectTaskToWeek, removeWeekTasksForProjectTask, syncTaskDeadlineToDeadlines, syncTaskCompletion } from "@/lib/sync";
import { FileAttachment } from "@/components/FileAttachment";
import { GCalButton, GCalSyncModal } from "@/components/GCalButton";
import { ColorPicker } from "@/components/ColorPicker";
import { logActivity } from "@/lib/activity";
import { useToast } from "@/components/Toast";
import { reorderRows, reorderSubtasks, cleanupActivityLog } from "@/lib/db-helpers";
import { Save, Upload, CalendarDays, Timer, RefreshCw, Calendar, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
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

  // Timer
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeSubtaskId, setActiveSubtaskId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const startElapsedRef = useRef<number>(0);
  const elapsedRef = useRef<Record<string, number>>({});

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
  const loadIdRef = useRef(0);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen && !subMenuOpen) return;
    const handler = () => { setMenuOpen(null); setSubMenuOpen(null); };
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

      const el: Record<string, number> = {};
      for (const t of tasksWithSubs) {
        el[t.id] = t.elapsed_seconds;
        for (const s of t.subtasks || []) el[`sub:${s.id}`] = s.elapsed_seconds || 0;
      }
      setElapsed((prev) => {
        const merged = { ...el };
        for (const key of Object.keys(prev)) {
          if (activeTaskId === key) merged[key] = prev[key];
        }
        return merged;
      });

      cleanupActivityLog(supabase, userId);
    } catch (err) {
      console.error("Project load failed:", err);
      toast("Failed to load project", "error");
    }
  }, [projectId, router, activeTaskId, userId, toast]);

  useEffect(() => { loadProject(); }, [loadProject]);

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

  // Timer logic — supports both task IDs and "sub:subtaskId"
  const startTimer = (timerId: string) => {
    if (activeTaskId) stopTimer();
    setActiveTaskId(timerId);
    startTimeRef.current = Date.now();
    startElapsedRef.current = elapsed[timerId] || 0;

    timerRef.current = setInterval(() => {
      const now = Date.now();
      const newElapsed = startElapsedRef.current + (now - startTimeRef.current) / 1000;
      setElapsed((prev) => ({ ...prev, [timerId]: newElapsed }));

      // 80% alarm check (only for main tasks)
      if (!timerId.startsWith("sub:")) {
        const task = tasks.find((t) => t.id === timerId);
        if (task && task.est_minutes > 0 && !project?.alarm_fired) {
          const threshold = task.est_minutes * 60 * 0.8;
          if (newElapsed >= threshold) {
            playAlarm();
            const supabase = createClient();
            supabase.from("projects").update({ alarm_fired: true }).eq("id", projectId);
            setProject((p) => p ? { ...p, alarm_fired: true } : p);
          }
        }
      }
    }, 1000);
  };

  const stopTimer = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (activeTaskId) {
      const supabase = createClient();
      const finalElapsed = elapsed[activeTaskId] || 0;
      const sessionTime = finalElapsed - startElapsedRef.current;

      if (activeTaskId.startsWith("sub:")) {
        const subId = activeTaskId.replace("sub:", "");
        await supabase.from("subtasks").update({ elapsed_seconds: finalElapsed }).eq("id", subId);
        // Find subtask name for logging
        let subName = "Subtask";
        for (const t of tasks) {
          const found = t.subtasks?.find((s) => s.id === subId);
          if (found) { subName = found.name; break; }
        }
        if (sessionTime > 5) {
          await logActivity(supabase, userId, projectId, "Timer stopped",
            `↳ ${subName} — ${formatSeconds(sessionTime)} tracked`);
        }
      } else {
        await supabase.from("project_tasks").update({ elapsed_seconds: finalElapsed }).eq("id", activeTaskId);
        const task = tasks.find((t) => t.id === activeTaskId);
        if (sessionTime > 5) {
          await logActivity(supabase, userId, projectId, "Timer stopped",
            `${task?.name || "Task"} — ${formatSeconds(sessionTime)} tracked`);
        }
      }
    }
    timerRef.current = null;
    setActiveTaskId(null);
  };

  const toggleTimer = (timerId: string) => {
    if (activeTaskId === timerId) stopTimer();
    else startTimer(timerId);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Keep ref in sync with state so auto-save always reads latest value
  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);

  // Auto-save timer every 5 seconds to prevent data loss
  useEffect(() => {
    if (!activeTaskId) return;

    const saveTimerToDB = async () => {
      const supabase = createClient();
      const current = elapsedRef.current[activeTaskId] || 0;
      if (activeTaskId.startsWith("sub:")) {
        const subId = activeTaskId.replace("sub:", "");
        await supabase.from("subtasks").update({ elapsed_seconds: current }).eq("id", subId);
      } else {
        await supabase.from("project_tasks").update({ elapsed_seconds: current }).eq("id", activeTaskId);
      }
    };

    const autoSave = setInterval(saveTimerToDB, 5000);

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        saveTimerToDB();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Timer is running — are you sure you want to leave?";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearInterval(autoSave);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [activeTaskId]);

  // Task CRUD
  const saveTaskModal = async () => {
    if (!formName.trim() || saving) return;
    setSaving(true);
    try {
    const supabase = createClient();
    const name = formName.trim();
    const calDate = formDate || null;       // → calendar (when to work on it)
    const deadline = formDeadline || null;  // → deadline dashboard (when it's due)
    let savedTaskId: string | null = null;

    if (modalMode === "task") {
      if (editTarget && "project_id" in editTarget) {
        savedTaskId = editTarget.id;
        await supabase
          .from("project_tasks")
          .update({ name, est_minutes: formEst, deadline, date_key: calDate })
          .eq("id", editTarget.id);

        updateTaskLocal(editTarget.id, { name, est_minutes: formEst, deadline, date_key: calDate });

        if (project) {
          await syncProjectTaskToWeek(supabase, userId, editTarget.id, name, projectId, project.title, calDate, (editTarget as ProjectTask).date_key);
          await syncTaskDeadlineToDeadlines(supabase, userId, editTarget.id, name, project.title, deadline);
        }
      } else {
        const { data: newTask } = await supabase.from("project_tasks").insert({
          project_id: projectId, user_id: userId, name,
          est_minutes: formEst, deadline, date_key: calDate, sort_order: tasks.length,
        }).select().single();

        if (newTask && project) {
          savedTaskId = newTask.id;
          addTaskLocal(newTask as ProjectTask);
          if (calDate) {
            await syncProjectTaskToWeek(supabase, userId, newTask.id, name, projectId, project.title, calDate, null);
          }
          if (deadline) {
            await syncTaskDeadlineToDeadlines(supabase, userId, newTask.id, name, project.title, deadline);
          }
        }
      }
    } else if (modalMode === "subtask" && parentTaskId) {
      const parent = tasks.find((t) => t.id === parentTaskId);
      if (editTarget && "task_id" in editTarget) {
        await supabase
          .from("subtasks")
          .update({ name, est_minutes: formEst, deadline, date_key: calDate })
          .eq("id", editTarget.id);
        updateSubtaskLocal(parentTaskId, editTarget.id, { name, est_minutes: formEst, deadline, date_key: calDate });
      } else {
        const { data: newSub } = await supabase.from("subtasks").insert({
          task_id: parentTaskId, user_id: userId, name,
          est_minutes: formEst, deadline, date_key: calDate,
          sort_order: (parent?.subtasks?.length || 0),
        }).select().single();
        if (newSub) {
          addSubtaskLocal(parentTaskId, newSub as Subtask);
          // Recalc parent progress to account for the new 0% subtask
          const allSubs = [...(parent?.subtasks || []), newSub as Subtask];
          const avg = Math.round(allSubs.reduce((s, st) => s + st.progress, 0) / allSubs.length);
          await supabase.from("project_tasks").update({ progress: avg }).eq("id", parentTaskId);
          updateTaskLocal(parentTaskId, { progress: avg });
        }
      }
      // Sync subtask to calendar
      if (project && parent) {
        const subText = `[${project.title}] ↳ ${name}`;
        if (editTarget && "task_id" in editTarget) {
          // Editing: find existing week_task and update or delete
          const { data: existingWt } = await supabase
            .from("week_tasks")
            .select("id")
            .eq("user_id", userId)
            .eq("project_task_id", parentTaskId)
            .ilike("text", `%↳ ${editTarget.name}`)
            .maybeSingle();

          if (!calDate && existingWt) {
            await supabase.from("week_tasks").delete().eq("id", existingWt.id);
          } else if (calDate && existingWt) {
            await supabase.from("week_tasks").update({ text: subText, date_key: calDate }).eq("id", existingWt.id);
          } else if (calDate) {
            await supabase.from("week_tasks").insert({
              user_id: userId, date_key: calDate, text: subText,
              sort_order: 999, done: false,
              project_id: projectId, project_task_id: parentTaskId,
            });
          }
        } else if (calDate) {
          // New subtask with date — create week_task
          await supabase.from("week_tasks").insert({
            user_id: userId, date_key: calDate, text: subText,
            sort_order: 999, done: false,
            project_id: projectId, project_task_id: parentTaskId,
          });
        }
      }
    }

    if (formRecurrence && deadline) {
      await supabase.from("deadlines").insert({
        user_id: userId,
        label: `[${project?.title}] ${name}`,
        target_datetime: `${deadline}T23:59:00`,
        recurrence: formRecurrence,
        source_task_id: savedTaskId,
      });
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
    const supabase = createClient();
    await removeWeekTasksForProjectTask(supabase, userId, taskId);
    await supabase.from("project_tasks").delete().eq("id", taskId);
    if (activeTaskId === taskId) stopTimer();
    await logActivity(supabase, userId, projectId, "Task removed", task?.name || "");
    setMenuOpen(null);
    removeTaskLocal(taskId);
  };

  const removeSubtask = async (subtaskId: string, parentId: string) => {
    if (!confirm("Remove this subtask?")) return;
    const supabase = createClient();
    await supabase.from("subtasks").delete().eq("id", subtaskId);
    removeSubtaskLocal(parentId, subtaskId);
    // Recalc parent progress from remaining subtasks
    const parent = tasks.find((t) => t.id === parentId);
    const remaining = (parent?.subtasks || []).filter((s) => s.id !== subtaskId);
    if (remaining.length > 0) {
      const avg = Math.round(remaining.reduce((s, st) => s + st.progress, 0) / remaining.length);
      await supabase.from("project_tasks").update({ progress: avg }).eq("id", parentId);
      updateTaskLocal(parentId, { progress: avg });
    }
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
    const supabase = createClient();
    const { error } = await supabase.from("project_tasks").update({ [field]: value }).eq("id", taskId);
    if (error) { toast("Failed to update task: " + error.message, "error"); return; }

    // Granular local update
    updateTaskLocal(taskId, { [field]: value } as Partial<ProjectTask>);

    const task = tasks.find((t) => t.id === taskId);

    if (field === "deadline" && task && project) {
      const res = await syncTaskDeadlineToDeadlines(supabase, userId, taskId, task.name, project.title, value as string | null);
      if (res.error) toast("Sync error: " + res.error, "error");
    }

    if (field === "date_key" && task && project) {
      const res = await syncProjectTaskToWeek(supabase, userId, taskId, task.name, projectId, project.title, value as string | null, task.date_key);
      if (res.error) toast("Sync error: " + res.error, "error");
    }

    if (field === "progress" && task) {
      const res = await syncTaskCompletion(supabase, userId, taskId, value as number);
      if (res.error) toast("Sync error: " + res.error, "error");
    }
  };

  const updateSubtaskField = async (subtaskId: string, parentId: string, field: string, value: string | number | null) => {
    const supabase = createClient();
    const { error } = await supabase.from("subtasks").update({ [field]: value }).eq("id", subtaskId);
    if (error) { toast("Failed to update subtask: " + error.message, "error"); return; }

    // Granular local update
    updateSubtaskLocal(parentId, subtaskId, { [field]: value } as Partial<Subtask>);

    if (field === "date_key" && project) {
      const parent = tasks.find((t) => t.id === parentId);
      const sub = parent?.subtasks?.find((s) => s.id === subtaskId);
      const subName = sub?.name || "Subtask";
      const subText = `[${project.title}] ↳ ${subName}`;

      // Find existing week_task for this subtask (matched by text + project_task_id)
      const { data: existing } = await supabase
        .from("week_tasks")
        .select("id")
        .eq("user_id", userId)
        .eq("project_task_id", parentId)
        .ilike("text", `%↳ ${subName}`)
        .maybeSingle();

      if (!value) {
        // Date cleared — delete linked week_task
        if (existing) {
          await supabase.from("week_tasks").delete().eq("id", existing.id);
        }
      } else if (existing) {
        // Date changed — update existing week_task
        await supabase.from("week_tasks").update({
          text: subText, date_key: value as string,
        }).eq("id", existing.id);
      } else {
        // New date — create week_task
        await supabase.from("week_tasks").insert({
          user_id: userId, date_key: value as string, text: subText,
          sort_order: 999, done: false,
          project_id: projectId, project_task_id: parentId,
        });
      }
    }

    if (field === "deadline" && project) {
      const parent = tasks.find((t) => t.id === parentId);
      const sub = parent?.subtasks?.find((s) => s.id === subtaskId);
      const subName = sub?.name || "Subtask";
      const label = `[${project.title}] ↳ ${subName}`;

      // Find existing deadline for this subtask (by label match)
      const { data: existing } = await supabase
        .from("deadlines")
        .select("id")
        .eq("user_id", userId)
        .eq("label", label)
        .maybeSingle();

      if (!value) {
        // Deadline cleared — delete
        if (existing) {
          await supabase.from("deadlines").delete().eq("id", existing.id);
        }
      } else if (existing) {
        // Deadline changed — update
        await supabase.from("deadlines").update({
          target_datetime: `${value}T23:59:00`,
        }).eq("id", existing.id);
      } else {
        // New deadline — create
        await supabase.from("deadlines").insert({
          user_id: userId,
          label,
          target_datetime: `${value}T23:59:00`,
        });
      }
    }

    if (field === "progress") {
      const parent = tasks.find((t) => t.id === parentId);
      if (parent?.subtasks) {
        const subs = parent.subtasks.map((s) =>
          s.id === subtaskId ? { ...s, progress: value as number } : s
        );
        const avg = Math.round(subs.reduce((s, st) => s + st.progress, 0) / subs.length);
        const { error: upErr } = await supabase.from("project_tasks").update({ progress: avg }).eq("id", parentId);
        if (upErr) { toast("Failed to update parent progress", "error"); }
        updateTaskLocal(parentId, { progress: avg });

        const res = await syncTaskCompletion(supabase, userId, parentId, avg);
        if (res.error) toast("Sync error: " + res.error, "error");
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
  const totalEst = tasks.reduce((s, t) => {
    const subEst = (t.subtasks || []).reduce((ss, sub) => ss + sub.est_minutes, 0);
    return s + t.est_minutes + subEst;
  }, 0);
  const totalElapsed = tasks.reduce((s, t) => {
    const taskTime = elapsed[t.id] || t.elapsed_seconds;
    const subTime = (t.subtasks || []).reduce((ss, sub) => ss + (elapsed[`sub:${sub.id}`] || sub.elapsed_seconds), 0);
    return s + taskTime + subTime;
  }, 0);
  const overallProgress = tasks.length > 0
    ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)
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
      alarm_fired: project.alarm_fired,
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

  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-red-acc border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
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
            <div className="mt-1 flex items-center gap-3">
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
          <div className="flex flex-wrap items-center gap-1 shrink-0 mt-1">
            <button
              onClick={saveAsTemplate}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt2 hover:text-violet2 hover:border-violet/30 transition-colors"
              title="Save as template"
            >
              <span className="flex items-center gap-1"><Save size={12} /> Template</span>
            </button>
            <button
              onClick={exportProject}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt2 hover:text-green-acc hover:border-green-acc/30 transition-colors"
              title="Export as JSON"
            >
              <span className="flex items-center gap-1"><Upload size={12} /> JSON</span>
            </button>
            <button
              onClick={exportProjectCSV}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt2 hover:text-green-acc hover:border-green-acc/30 transition-colors"
              title="Export as CSV"
            >
              <span className="flex items-center gap-1"><Upload size={12} /> CSV</span>
            </button>
            <button
              onClick={() => setGcalModalOpen(true)}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt2 hover:text-amber hover:border-amber/30 transition-colors"
              title="Sync deadlines to Google Calendar"
            >
              <span className="flex items-center gap-1"><Calendar size={12} /> GCal Sync</span>
            </button>
            <button
              onClick={() => { setDescDraft(project.description || ""); setDescModalOpen(true); }}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt2 hover:text-txt hover:border-border2 transition-colors"
            >
              <span className="flex items-center gap-1"><Pencil size={12} /> Edit</span>
            </button>
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt3 hover:text-danger hover:border-danger/30 transition-colors"
            >
              <span className="flex items-center gap-1"><Trash2 size={12} /> Delete</span>
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

      {/* Progress */}
      <div className="mb-6">
        <ProgressBar value={overallProgress} showLabel label="Overall Progress" height={10} />
      </div>

      {/* Task list */}
      <div className="space-y-2 mb-4">
        {tasks.map((task, idx) => {
          const isActive = activeTaskId === task.id;
          const isDone = task.progress >= 100;
          const isExpanded = expandedTasks.has(task.id);

          return (
            <div
              key={task.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
            >
              <div
                className={cn(
                  "bg-surface border rounded-lg transition-all",
                  isActive ? "border-green-acc shadow-lg shadow-green-acc/10" : "border-border",
                  isDone && "opacity-60"
                )}
              >
                {/* Row 1: drag + play + name */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="cursor-grab text-txt3 hover:text-txt select-none">⠿</span>
                  <button
                    onClick={() => toggleTimer(task.id)}
                    className={cn(
                      "w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 transition-colors",
                      isActive
                        ? "bg-green-acc/20 text-green-acc"
                        : "bg-surface2 text-txt3 hover:text-red-acc hover:bg-red-acc/10"
                    )}
                  >
                    {isActive ? "⏸" : "▶"}
                  </button>
                  <span className={cn("flex-1 text-sm font-medium", isDone && "task-done")}>
                    {task.name}
                  </span>
                  {isActive && (
                    <span className="font-mono text-sm text-green-acc timer-active">
                      {formatSeconds(elapsed[task.id] || 0)}
                    </span>
                  )}
                </div>

                {/* Row 2: meta */}
                <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 text-xs">
                  {/* Est */}
                  <span className="bg-surface2 text-txt3 px-2 py-0.5 rounded font-mono">
                    {formatMinutes(task.est_minutes)}
                  </span>

                  {/* Calendar date — when to work on it */}
                  {task.progress < 100 && (
                    <CalendarPicker
                      value={task.date_key}
                      onChange={(d) => updateTaskField(task.id, "date_key", d)}
                      variant="date"
                    />
                  )}
                  {task.date_key && task.progress >= 100 && (
                    <span className="text-[10px] text-green-acc font-mono">✓ scheduled</span>
                  )}

                  {/* Deadline — when it's due */}
                  {task.progress < 100 && (
                    <>
                      <CalendarPicker
                        value={task.deadline}
                        onChange={(d) => updateTaskField(task.id, "deadline", d)}
                        variant="deadline"
                      />
                      <GCalButton
                        title={`[${project.title}] ${task.name}`}
                        date={task.date_key || task.deadline}
                        description={task.notes}
                      />
                    </>
                  )}
                  {task.progress >= 100 && task.deadline && (
                    <span className="text-[10px] text-green-acc font-mono">✓ done</span>
                  )}

                  {/* Progress */}
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 h-1.5 bg-surface3 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${Math.min(task.progress, 100)}%`,
                        backgroundColor: progressColor(task.progress),
                      }} />
                    </div>
                    <InlineEdit
                      value={String(task.progress)}
                      onSave={(v) => updateTaskField(task.id, "progress", parseInt(v) || 0)}
                      type="number"
                      min={0}
                      max={100}
                      className="w-10 text-xs"
                    />
                    <span className="text-txt3">%</span>
                  </div>

                  {/* Notes */}
                  <div className="flex-1 min-w-[120px]">
                    <InlineEdit
                      value={task.notes}
                      onSave={(v) => updateTaskField(task.id, "notes", v)}
                      placeholder="Notes..."
                      className="text-xs text-txt3"
                    />
                  </div>

                  {/* File */}
                  <FileAttachment
                    fileUrl={task.file_url}
                    fileName={task.file_name}
                    userId={userId}
                    entityId={task.id}
                    onUploaded={async (url, name) => {
                      const supabase = createClient();
                      await supabase.from("project_tasks").update({ file_url: url, file_name: name }).eq("id", task.id);
                      updateTaskLocal(task.id, { file_url: url, file_name: name });
                    }}
                    onRemoved={async () => {
                      const supabase = createClient();
                      await supabase.from("project_tasks").update({ file_url: null, file_name: null }).eq("id", task.id);
                      updateTaskLocal(task.id, { file_url: null, file_name: null });
                    }}
                  />

                  {/* Expand subtasks */}
                  {(task.subtasks?.length || 0) > 0 && (
                    <button
                      onClick={() => {
                        const s = new Set(expandedTasks);
                        s.has(task.id) ? s.delete(task.id) : s.add(task.id);
                        setExpandedTasks(s);
                      }}
                      className="text-txt3 hover:text-txt transition-colors"
                    >
                      {isExpanded ? "▾" : "▸"} {task.subtasks?.length}
                    </button>
                  )}

                  {/* Menu */}
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(menuOpen === task.id ? null : task.id)}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface2 text-txt3"
                    >
                      ⋯
                    </button>
                    {menuOpen === task.id && (
                      <div className="absolute right-0 top-full mt-1 bg-surface2 border border-border rounded-lg shadow-xl py-1 w-36 z-20">
                        <button
                          onClick={() => {
                            setEditTarget(task);
                            setFormName(task.name);
                            setFormEst(task.est_minutes);
                            setFormDate(task.date_key || "");
                            setFormDeadline(task.deadline || "");
                            setFormRecurrence(null);
                            setModalMode("task");
                            setModalOpen(true);
                            setMenuOpen(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-sm text-txt2 hover:bg-surface3"
                        >
                          Edit
                        </button>
                        {(task.subtasks?.length || 0) < 10 && (
                          <button
                            onClick={() => {
                              setEditTarget(null);
                              setParentTaskId(task.id);
                              setFormName("");
                              setFormEst(0);
                              setFormDate("");
                              setFormDeadline("");
                              setFormRecurrence(null);
                              setModalMode("subtask");
                              setModalOpen(true);
                              setMenuOpen(null);
                            }}
                            className="w-full text-left px-3 py-1.5 text-sm text-txt2 hover:bg-surface3"
                          >
                            Add subtask
                          </button>
                        )}
                        <button
                          onClick={() => { removeTask(task.id); }}
                          className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-surface3"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Subtasks */}
                {isExpanded && task.subtasks && task.subtasks.length > 0 && (
                  <div className="border-t border-border bg-surface2/50">
                    {task.subtasks.map((sub, subIdx) => (
                      <div
                        key={sub.id}
                        draggable
                        onDragStart={() => handleSubDragStart(task.id, subIdx)}
                        onDragOver={(e) => handleSubDragOver(e, task.id, subIdx)}
                        onDragEnd={() => handleSubDragEnd(task.id)}
                        className={cn(
                          "flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/50 last:border-b-0 text-xs",
                          activeTaskId === `sub:${sub.id}` && "bg-green-acc/5",
                          dragSubIdx === subIdx && dragSubParent === task.id && "opacity-50"
                        )}
                      >
                        <span className="cursor-grab text-txt3 opacity-30 hover:opacity-100 select-none text-[10px]">⠿</span>
                        <button
                          onClick={() => toggleTimer(`sub:${sub.id}`)}
                          className={cn(
                            "w-6 h-6 rounded flex items-center justify-center text-[10px] shrink-0 transition-colors",
                            activeTaskId === `sub:${sub.id}`
                              ? "bg-green-acc/20 text-green-acc"
                              : "bg-surface3 text-txt3 hover:text-red-acc"
                          )}
                        >
                          {activeTaskId === `sub:${sub.id}` ? "⏸" : "▶"}
                        </button>
                        {activeTaskId === `sub:${sub.id}` && (
                          <span className="font-mono text-[10px] text-green-acc timer-active">
                            {formatSeconds(elapsed[`sub:${sub.id}`] || 0)}
                          </span>
                        )}
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: progressColor(sub.progress) }} />
                        <InlineEdit value={sub.name} onSave={(v) => updateSubtaskField(sub.id, task.id, "name", v)} className="font-medium text-xs min-w-[100px]" />
                        <InlineEdit value={String(sub.est_minutes)} onSave={(v) => updateSubtaskField(sub.id, task.id, "est_minutes", parseInt(v) || 0)} type="number" min={0} className="w-10 text-xs text-txt3" placeholder="0" />
                        <span className="text-txt3 text-[10px]">min</span>
                        <div className="flex items-center gap-1">
                          <InlineEdit value={String(sub.progress)} onSave={(v) => updateSubtaskField(sub.id, task.id, "progress", parseInt(v) || 0)} type="number" min={0} max={100} className="w-10 text-xs" />
                          <span className="text-txt3">%</span>
                        </div>
                        {sub.progress < 100 ? (
                          <>
                            <CalendarPicker value={sub.date_key} onChange={(d) => updateSubtaskField(sub.id, task.id, "date_key", d)} variant="date" />
                            <CalendarPicker value={sub.deadline} onChange={(d) => updateSubtaskField(sub.id, task.id, "deadline", d)} variant="deadline" />
                          </>
                        ) : (sub.deadline || sub.date_key) ? (
                          <span className="text-[10px] text-green-acc font-mono">✓</span>
                        ) : null}
                        <div className="flex-1 min-w-[80px]">
                          <InlineEdit value={sub.notes} onSave={(v) => updateSubtaskField(sub.id, task.id, "notes", v)} placeholder="Notes..." className="text-xs text-txt3" />
                        </div>
                        <FileAttachment
                          fileUrl={sub.file_url} fileName={sub.file_name} userId={userId} entityId={sub.id}
                          onUploaded={async (url, name) => { const s = createClient(); await s.from("subtasks").update({ file_url: url, file_name: name }).eq("id", sub.id); updateSubtaskLocal(task.id, sub.id, { file_url: url, file_name: name }); }}
                          onRemoved={async () => { const s = createClient(); await s.from("subtasks").update({ file_url: null, file_name: null }).eq("id", sub.id); updateSubtaskLocal(task.id, sub.id, { file_url: null, file_name: null }); }}
                        />
                        {/* Subtask 3-dot menu */}
                        <div className="relative">
                          <button onClick={(e) => { e.stopPropagation(); setSubMenuOpen(subMenuOpen === sub.id ? null : sub.id); }}
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface3 text-txt3 text-[10px]">⋯</button>
                          {subMenuOpen === sub.id && (
                            <div className="absolute right-0 top-full mt-1 bg-surface2 border border-border rounded-lg shadow-xl py-1 w-40 z-20">
                              <button onClick={() => { setEditTarget(sub); setParentTaskId(task.id); setFormName(sub.name); setFormEst(sub.est_minutes); setFormDate(sub.date_key || ""); setFormDeadline(sub.deadline || ""); setFormRecurrence(null); setModalMode("subtask"); setModalOpen(true); setSubMenuOpen(null); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-txt2 hover:bg-surface3">Edit</button>
                              <button onClick={() => { setMoveSubModal({ subId: sub.id, subName: sub.name, fromTaskId: task.id }); setSubMenuOpen(null); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-txt2 hover:bg-surface3">Move to task...</button>
                              <button onClick={() => { removeSubtask(sub.id, task.id); setSubMenuOpen(null); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface3">Remove</button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {tasks.length === 0 && (
          <div className="text-center py-12 text-txt3">
            <p className="text-lg mb-2">No tasks yet</p>
            <p className="text-sm">Add tasks to track your project progress</p>
          </div>
        )}
      </div>

      {/* Add task */}
      <button
        onClick={() => {
          setEditTarget(null);
          setFormName("");
          setFormEst(0);
          setFormDate("");
          setFormDeadline("");
          setFormRecurrence(null);
          setModalMode("task");
          setModalOpen(true);
        }}
        className="w-full bg-surface border border-dashed border-border2 rounded-lg px-4 py-3 text-sm text-txt3 hover:border-red-acc hover:text-red-acc transition-colors"
      >
        ＋ Add Task
      </button>

      {/* Task/Subtask Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          modalMode === "task"
            ? editTarget ? "Edit Task" : "Add Task"
            : editTarget ? "Edit Subtask" : "Add Subtask"
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Name</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveTaskModal()}
              className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Est. minutes</label>
            <input
              type="number"
              value={formEst}
              onChange={(e) => setFormEst(parseInt(e.target.value) || 0)}
              min={0}
              className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
            />
          </div>
          <div>
            <label className="text-sm text-txt2 mb-1.5 flex items-center gap-1.5"><CalendarDays size={14} /> Schedule on calendar</label>
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
            />
            {formDate && <p className="text-[10px] text-violet2 mt-1">Task will appear on the calendar for this date</p>}
          </div>
          <div>
            <label className="text-sm text-txt2 mb-1.5 flex items-center gap-1.5"><Timer size={14} /> Deadline (due date)</label>
            <input
              type="date"
              value={formDeadline}
              onChange={(e) => setFormDeadline(e.target.value)}
              className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
            />
            {formDeadline && <p className="text-[10px] text-danger mt-1">A countdown deadline will be created</p>}
          </div>
          {formDeadline && (
            <div>
              <label className="text-sm text-txt2 mb-1.5 flex items-center gap-1.5"><RefreshCw size={14} /> Recurring?</label>
              <select value={formRecurrence || ""} onChange={(e) => setFormRecurrence(e.target.value || null)}
                className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm">
                <option value="">No — one-time deadline</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3"
            >
              Cancel
            </button>
            <button
              onClick={saveTaskModal}
              disabled={!formName.trim() || saving}
              className="px-4 py-2 rounded-lg text-sm bg-red-acc hover:bg-red-dark text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </Modal>

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
            className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm h-32 resize-none"
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
                className="w-full text-left px-3 py-2.5 rounded-lg bg-surface border border-border text-sm text-txt hover:border-violet/50 hover:text-violet2 transition-colors">
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
    </div>
  );
}
