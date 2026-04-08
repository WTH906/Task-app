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
import { syncProjectTaskToWeek, removeWeekTasksForProjectTask, syncTaskDeadlineToDeadlines } from "@/lib/sync";
import { FileAttachment } from "@/components/FileAttachment";
import { GCalButton, GCalSyncModal } from "@/components/GCalButton";
import { ColorPicker } from "@/components/ColorPicker";
import { logActivity } from "@/lib/activity";

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [userId, setUserId] = useState("");

  // Timer
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeSubtaskId, setActiveSubtaskId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const startElapsedRef = useRef<number>(0);

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

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen]);

  const loadProject = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: proj } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (!proj) { router.push("/projects"); return; }
    setProject(proj);

    const { data: taskData } = await supabase
      .from("project_tasks")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order");

    const tasksWithSubs: ProjectTask[] = [];
    for (const t of taskData || []) {
      const { data: subs } = await supabase
        .from("subtasks")
        .select("*")
        .eq("task_id", t.id)
        .order("sort_order");
      tasksWithSubs.push({ ...t, subtasks: subs || [] });
    }

    setTasks(tasksWithSubs);

    // Init elapsed
    const el: Record<string, number> = {};
    for (const t of tasksWithSubs) {
      el[t.id] = t.elapsed_seconds;
      for (const s of t.subtasks || []) el[`sub:${s.id}`] = s.elapsed_seconds || 0;
    }
    setElapsed(el);
  }, [projectId, router]);

  useEffect(() => { loadProject(); }, [loadProject]);

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

  // Task CRUD
  const saveTaskModal = async () => {
    if (!formName.trim()) return;
    const supabase = createClient();
    const name = formName.trim();
    const calDate = formDate || null;       // → appears on calendar
    const deadline = formDeadline || null;   // → appears in deadlines

    if (modalMode === "task") {
      if (editTarget && "project_id" in editTarget) {
        // EDIT existing task
        await supabase
          .from("project_tasks")
          .update({ name, est_minutes: formEst, deadline })
          .eq("id", editTarget.id);

        // Sync calendar date
        if (project) {
          await syncProjectTaskToWeek(supabase, userId, editTarget.id, name, projectId, project.title, calDate, editTarget.deadline);
        }
        // Sync deadline
        if (project) {
          await syncTaskDeadlineToDeadlines(supabase, userId, editTarget.id, name, project.title, deadline);
        }
      } else {
        // CREATE new task
        const { data: newTask } = await supabase.from("project_tasks").insert({
          project_id: projectId, user_id: userId, name,
          est_minutes: formEst, deadline, sort_order: tasks.length,
        }).select().single();

        if (newTask && project) {
          // Create calendar entry if date is set
          if (calDate) {
            await syncProjectTaskToWeek(supabase, userId, newTask.id, name, projectId, project.title, calDate, null);
          }
          // Create deadline entry if deadline is set
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
          .update({ name, est_minutes: formEst, deadline })
          .eq("id", editTarget.id);
      } else {
        await supabase.from("subtasks").insert({
          task_id: parentTaskId, user_id: userId, name,
          est_minutes: formEst, deadline,
          sort_order: (parent?.subtasks?.length || 0),
        });
      }
    }

    // Create recurring deadline if recurrence is set
    if (formRecurrence && deadline) {
      await supabase.from("deadlines").upsert({
        user_id: userId,
        label: `[${project?.title}] ${name}`,
        target_datetime: `${deadline}T23:59:00`,
        recurrence: formRecurrence,
      });
    }

    setModalOpen(false);
    setFormDate("");
    setFormDeadline("");
    setFormRecurrence(null);
    // Auto-expand parent task when adding a subtask
    if (modalMode === "subtask" && parentTaskId) {
      setExpandedTasks((prev) => new Set(prev).add(parentTaskId));
    }
    if (!editTarget) {
      const supabase2 = createClient();
      await logActivity(supabase2, userId, projectId,
        modalMode === "task" ? "Task added" : "Subtask added", formName.trim());
    }
    loadProject();
  };

  const removeTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    const supabase = createClient();
    await removeWeekTasksForProjectTask(supabase, userId, taskId);
    await supabase.from("project_tasks").delete().eq("id", taskId);
    if (activeTaskId === taskId) stopTimer();
    await logActivity(supabase, userId, projectId, "Task removed", task?.name || "");
    setMenuOpen(null);
    loadProject();
  };

  const removeSubtask = async (subtaskId: string, parentId: string) => {
    const supabase = createClient();
    await supabase.from("subtasks").delete().eq("id", subtaskId);
    // Recalc parent progress
    const parent = tasks.find((t) => t.id === parentId);
    const remaining = (parent?.subtasks || []).filter((s) => s.id !== subtaskId);
    if (remaining.length > 0) {
      const avg = Math.round(remaining.reduce((s, st) => s + st.progress, 0) / remaining.length);
      await supabase.from("project_tasks").update({ progress: avg }).eq("id", parentId);
    }
    loadProject();
  };

  const updateTaskField = async (taskId: string, field: string, value: string | number | null) => {
    const supabase = createClient();
    await supabase.from("project_tasks").update({ [field]: value }).eq("id", taskId);

    const task = tasks.find((t) => t.id === taskId);

    // Sync deadline to week + deadlines tab
    if (field === "deadline") {
      if (task && project) {
        await syncProjectTaskToWeek(
          supabase, userId, taskId, task.name, projectId, project.title,
          value as string | null, task.deadline
        );
        await syncTaskDeadlineToDeadlines(
          supabase, userId, taskId, task.name, project.title,
          value as string | null
        );
      }
    }

    // When progress changes, sync to week_tasks and deadlines
    if (field === "progress" && task) {
      const progress = value as number;
      // Mark linked week_task as done/undone
      const { data: linkedWeek } = await supabase
        .from("week_tasks")
        .select("id")
        .eq("project_task_id", taskId)
        .eq("user_id", userId);
      for (const wt of linkedWeek || []) {
        await supabase.from("week_tasks").update({ done: progress >= 100 }).eq("id", wt.id);
      }
      // If 100%, remove the deadline entry
      if (progress >= 100 && project) {
        await syncTaskDeadlineToDeadlines(supabase, userId, taskId, task.name, project.title, null);
      }
    }

    loadProject();
  };

  const updateSubtaskField = async (subtaskId: string, parentId: string, field: string, value: string | number | null) => {
    const supabase = createClient();
    await supabase.from("subtasks").update({ [field]: value }).eq("id", subtaskId);

    // Recalc parent progress if progress changed
    if (field === "progress") {
      const parent = tasks.find((t) => t.id === parentId);
      if (parent?.subtasks) {
        const subs = parent.subtasks.map((s) =>
          s.id === subtaskId ? { ...s, progress: value as number } : s
        );
        const avg = Math.round(subs.reduce((s, st) => s + st.progress, 0) / subs.length);
        await supabase.from("project_tasks").update({ progress: avg }).eq("id", parentId);

        // Sync parent completion to calendar + deadlines
        const { data: linkedWeek } = await supabase
          .from("week_tasks").select("id").eq("project_task_id", parentId).eq("user_id", userId);
        for (const wt of linkedWeek || []) {
          await supabase.from("week_tasks").update({ done: avg >= 100 }).eq("id", wt.id);
        }
        if (avg >= 100 && project) {
          await syncTaskDeadlineToDeadlines(supabase, userId, parentId, parent.name, project.title, null);
        }
      }
    }

    loadProject();
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
    const supabase = createClient();
    await Promise.all(
      tasks.map((t, i) => supabase.from("project_tasks").update({ sort_order: i }).eq("id", t.id))
    );
  };

  // Calculations
  const totalEst = tasks.reduce((s, t) => s + t.est_minutes, 0);
  const totalElapsed = tasks.reduce((s, t) => s + (elapsed[t.id] || t.elapsed_seconds), 0);
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
              💾 Template
            </button>
            <button
              onClick={exportProject}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt2 hover:text-green-acc hover:border-green-acc/30 transition-colors"
              title="Export as JSON"
            >
              📤 Export
            </button>
            <button
              onClick={() => setGcalModalOpen(true)}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt2 hover:text-amber hover:border-amber/30 transition-colors"
              title="Sync deadlines to Google Calendar"
            >
              📆 GCal Sync
            </button>
            <button
              onClick={() => { setDescDraft(project.description || ""); setDescModalOpen(true); }}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt2 hover:text-txt hover:border-border2 transition-colors"
            >
              ✎ Edit
            </button>
            <button
              onClick={async () => {
                if (!confirm(`Delete project "${project.title}"? This cannot be undone.`)) return;
                const supabase = createClient();
                await supabase.from("projects").delete().eq("id", projectId);
                window.dispatchEvent(new Event("projects-changed"));
                router.push("/routine");
              }}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt3 hover:text-danger hover:border-danger/30 transition-colors"
            >
              🗑 Delete
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
                  <span className="text-danger font-medium">
                    ⚠ Overtime: +{formatSeconds(overtimeSec)}
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

                  {/* Deadline — hidden when task is 100% */}
                  {task.progress < 100 && (
                    <>
                      <CalendarPicker
                        value={task.deadline}
                        onChange={(d) => updateTaskField(task.id, "deadline", d)}
                      />
                      <GCalButton
                        title={`[${project.title}] ${task.name}`}
                        date={task.deadline}
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
                      loadProject();
                    }}
                    onRemoved={async () => {
                      const supabase = createClient();
                      await supabase.from("project_tasks").update({ file_url: null, file_name: null }).eq("id", task.id);
                      loadProject();
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
                            setFormDate("");
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
                    {task.subtasks.map((sub) => (
                      <div
                        key={sub.id}
                        className={cn(
                          "flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/50 last:border-b-0 text-xs",
                          activeTaskId === `sub:${sub.id}` && "bg-green-acc/5"
                        )}
                      >
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
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: progressColor(sub.progress) }}
                        />
                        <InlineEdit
                          value={sub.name}
                          onSave={(v) => updateSubtaskField(sub.id, task.id, "name", v)}
                          className="font-medium text-xs min-w-[100px]"
                        />
                        {/* Est time */}
                        <InlineEdit
                          value={String(sub.est_minutes)}
                          onSave={(v) => updateSubtaskField(sub.id, task.id, "est_minutes", parseInt(v) || 0)}
                          type="number"
                          min={0}
                          className="w-10 text-xs text-txt3"
                          placeholder="0"
                        />
                        <span className="text-txt3 text-[10px]">min</span>
                        <div className="flex items-center gap-1">
                          <InlineEdit
                            value={String(sub.progress)}
                            onSave={(v) => updateSubtaskField(sub.id, task.id, "progress", parseInt(v) || 0)}
                            type="number"
                            min={0}
                            max={100}
                            className="w-10 text-xs"
                          />
                          <span className="text-txt3">%</span>
                        </div>
                        {sub.progress < 100 ? (
                          <CalendarPicker
                            value={sub.deadline}
                            onChange={(d) => updateSubtaskField(sub.id, task.id, "deadline", d)}
                          />
                        ) : sub.deadline ? (
                          <span className="text-[10px] text-green-acc font-mono">✓</span>
                        ) : null}
                        <div className="flex-1 min-w-[80px]">
                          <InlineEdit
                            value={sub.notes}
                            onSave={(v) => updateSubtaskField(sub.id, task.id, "notes", v)}
                            placeholder="Notes..."
                            className="text-xs text-txt3"
                          />
                        </div>
                        <FileAttachment
                          fileUrl={sub.file_url}
                          fileName={sub.file_name}
                          userId={userId}
                          entityId={sub.id}
                          onUploaded={async (url, name) => {
                            const supabase = createClient();
                            await supabase.from("subtasks").update({ file_url: url, file_name: name }).eq("id", sub.id);
                            loadProject();
                          }}
                          onRemoved={async () => {
                            const supabase = createClient();
                            await supabase.from("subtasks").update({ file_url: null, file_name: null }).eq("id", sub.id);
                            loadProject();
                          }}
                        />
                        <button
                          onClick={() => removeSubtask(sub.id, task.id)}
                          className="text-txt3 hover:text-danger transition-colors"
                        >
                          ✕
                        </button>
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
            <label className="block text-sm text-txt2 mb-1.5">📅 Schedule on calendar</label>
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
            />
            {formDate && <p className="text-[10px] text-violet2 mt-1">Task will appear on the calendar for this date</p>}
          </div>
          <div>
            <label className="block text-sm text-txt2 mb-1.5">⏳ Deadline (due date)</label>
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
              <label className="block text-sm text-txt2 mb-1.5">🔄 Recurring?</label>
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
              disabled={!formName.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-red-acc hover:bg-red-dark text-white disabled:opacity-50"
            >
              Save
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
    </div>
  );
}
