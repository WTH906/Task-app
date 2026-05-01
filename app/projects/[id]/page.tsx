"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Project, ProjectTask, Subtask } from "@/lib/types";
import { formatSeconds, formatMinutes } from "@/lib/utils";
import { useTimer } from "@/lib/hooks/useTimer";
import { ProgressBar } from "@/components/ProgressBar";
import { InlineEdit } from "@/components/InlineEdit";
import { CalendarPicker } from "@/components/CalendarPicker";
import { Modal } from "@/components/Modal";
import { syncProjectTaskToWeek, syncSubtaskToWeek, removeWeekTasksForProjectTask, syncTaskDeadlineToDeadlines, syncTaskCompletion } from "@/lib/sync";
import { GCalSyncModal } from "@/components/GCalButton";
import { ColorPicker } from "@/components/ColorPicker";
import { logActivity } from "@/lib/activity";
import { useToast } from "@/components/Toast";
import { reorderRows, reorderSubtasks, cleanupActivityLog } from "@/lib/db-helpers";
import { Save, Upload, Calendar, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
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

  // Close menu on outside click
  useEffect(() => { document.title = project ? `Comfy Board — ${project.title}` : "Comfy Board — Project"; }, [project]);

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

  // Task CRUD
  const saveTaskModal = async () => {
    if (!formName.trim() || saving) return;
    setSaving(true);
    try {
    const supabase = createClient();
    const name = formName.trim();
    const calDate = formDate || null;       // → calendar (when to work on it)
    const deadline = formDeadline || null;  // → deadline dashboard (when it's due)

    if (modalMode === "task") {
      if (editTarget && "project_id" in editTarget) {
        await supabase
          .from("project_tasks")
          .update({ name, est_minutes: formEst, deadline, date_key: calDate })
          .eq("id", editTarget.id);

        updateTaskLocal(editTarget.id, { name, est_minutes: formEst, deadline, date_key: calDate });

        if (project) {
          await syncProjectTaskToWeek(supabase, userId, editTarget.id, name, projectId, project.title, calDate, (editTarget as ProjectTask).date_key);
          await syncTaskDeadlineToDeadlines(supabase, userId, editTarget.id, name, project.title, deadline, formRecurrence);
        }
      } else {
        const { data: newTask } = await supabase.from("project_tasks").insert({
          project_id: projectId, user_id: userId, name,
          est_minutes: formEst, deadline, date_key: calDate, sort_order: tasks.length,
        }).select().single();

        if (newTask && project) {
          addTaskLocal(newTask as ProjectTask);
          if (calDate) {
            await syncProjectTaskToWeek(supabase, userId, newTask.id, name, projectId, project.title, calDate, null);
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
          .update({ name, est_minutes: formEst, deadline, date_key: calDate })
          .eq("id", editTarget.id);
        updateSubtaskLocal(parentTaskId, editTarget.id, { name, est_minutes: formEst, deadline, date_key: calDate });
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
    // Recalc parent progress and est_minutes from remaining subtasks
    const parent = tasks.find((t) => t.id === parentId);
    const remaining = (parent?.subtasks || []).filter((s) => s.id !== subtaskId);
    if (remaining.length > 0) {
      const avg = Math.round(remaining.reduce((s, st) => s + st.progress, 0) / remaining.length);
      const totalEst = remaining.reduce((s, st) => s + st.est_minutes, 0);
      await supabase.from("project_tasks").update({ progress: avg, est_minutes: totalEst }).eq("id", parentId);
      updateTaskLocal(parentId, { progress: avg, est_minutes: totalEst });
    } else {
      // No subtasks left — reset est_minutes to 0
      await supabase.from("project_tasks").update({ est_minutes: 0 }).eq("id", parentId);
      updateTaskLocal(parentId, { est_minutes: 0 });
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
      // Sync via subtask_id FK — not text matching
      await syncSubtaskToWeek(supabase, userId, subtaskId, parentId, subName, projectId, project.title, value as string | null);
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

    if (field === "est_minutes") {
      // Recalc parent est_minutes = sum of all subtask est_minutes
      const parent = tasks.find((t) => t.id === parentId);
      if (parent?.subtasks) {
        const subs = parent.subtasks.map((s) =>
          s.id === subtaskId ? { ...s, est_minutes: value as number } : s
        );
        const totalEst = subs.reduce((s, st) => s + st.est_minutes, 0);
        await supabase.from("project_tasks").update({ est_minutes: totalEst }).eq("id", parentId);
        updateTaskLocal(parentId, { est_minutes: totalEst });
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
    setFormRecurrence(null);
    setModalMode(mode);
    setModalOpen(true);
  };

  const taskActions: TaskActions = {
    toggleTimer, removeTask, removeSubtask,
    updateTaskField, updateSubtaskField,
    updateTaskLocal, updateSubtaskLocal,
    openEditModal, setExpandedTasks, setMoveSubModal,
    handleSubDragStart, handleSubDragOver, handleSubDragEnd,
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

      {/* Progress */}
      <div className="mb-6">
        <ProgressBar value={overallProgress} showLabel label="Overall Progress" height={10} />
      </div>

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

      {/* Add task */}
      <button
        onClick={() => openEditModal(null, "task")}
        className="w-full bg-surface border border-dashed border-border2 rounded-lg px-4 py-3 text-sm text-txt3 hover:border-red-acc hover:text-red-acc transition-colors"
      >
        ＋ Add Task
      </button>

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
            className="w-full bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-txt text-sm h-32 resize-none"
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
                className="w-full text-left px-3 py-2.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-txt hover:border-violet/50 hover:text-violet2 transition-colors">
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
