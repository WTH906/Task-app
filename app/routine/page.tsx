"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { RoutineTask } from "@/lib/types";
import { formatMinutes, cn, toLocalDateStr } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import { Modal } from "@/components/Modal";

export default function RoutinePage() {
  const [tasks, setTasks] = useState<RoutineTask[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<RoutineTask | null>(null);
  const [formText, setFormText] = useState("");
  const [formEst, setFormEst] = useState(0);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen]);

  const today = toLocalDateStr(new Date());

  const loadTasks = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: taskData } = await supabase
      .from("routine_tasks")
      .select("*")
      .eq("user_id", user.id)
      .order("sort_order");

    const { data: checks } = await supabase
      .from("routine_checks")
      .select("task_id")
      .eq("user_id", user.id)
      .eq("checked_date", today);

    const checkedIds = new Set((checks || []).map((c: { task_id: string }) => c.task_id));

    setTasks(
      (taskData || []).map((t: RoutineTask) => ({
        ...t,
        checked: checkedIds.has(t.id),
      }))
    );
  }, [today]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const toggleCheck = async (task: RoutineTask) => {
    const supabase = createClient();
    const newChecked = !task.checked;

    // Optimistic
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, checked: newChecked } : t))
    );

    if (newChecked) {
      await supabase.from("routine_checks").insert({
        user_id: userId,
        task_id: task.id,
        checked_date: today,
      });
    } else {
      await supabase
        .from("routine_checks")
        .delete()
        .eq("task_id", task.id)
        .eq("checked_date", today);
    }
  };

  const saveTask = async () => {
    if (!formText.trim() || !userId) return;
    const supabase = createClient();

    if (editingTask) {
      await supabase
        .from("routine_tasks")
        .update({ text: formText.trim(), est_minutes: formEst })
        .eq("id", editingTask.id);
    } else {
      await supabase.from("routine_tasks").insert({
        user_id: userId,
        text: formText.trim(),
        est_minutes: formEst,
        sort_order: tasks.length,
      });
    }

    setModalOpen(false);
    setEditingTask(null);
    setFormText("");
    setFormEst(0);
    loadTasks();
  };

  const removeTask = async (id: string) => {
    const supabase = createClient();
    await supabase.from("routine_tasks").delete().eq("id", id);
    loadTasks();
  };

  const openEdit = (task: RoutineTask) => {
    setEditingTask(task);
    setFormText(task.text);
    setFormEst(task.est_minutes);
    setModalOpen(true);
    setMenuOpen(null);
  };

  const openAdd = () => {
    setEditingTask(null);
    setFormText("");
    setFormEst(0);
    setModalOpen(true);
  };

  // Drag and drop
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newTasks = [...tasks];
    const [moved] = newTasks.splice(dragIdx, 1);
    newTasks.splice(idx, 0, moved);
    setTasks(newTasks);
    setDragIdx(idx);
  };
  const handleDragEnd = async () => {
    setDragIdx(null);
    const supabase = createClient();
    const updates = tasks.map((t, i) =>
      supabase.from("routine_tasks").update({ sort_order: i }).eq("id", t.id)
    );
    await Promise.all(updates);
  };

  const checked = tasks.filter((t) => t.checked).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  const totalEst = tasks.reduce((s, t) => s + t.est_minutes, 0);
  const remainEst = tasks.filter((t) => !t.checked).reduce((s, t) => s + t.est_minutes, 0);

  const dateObj = new Date();
  const dateStr = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs text-txt3 uppercase tracking-wider mb-1">{dateStr}</p>
        <h1 className="font-title text-2xl text-bright mb-1">Daily Routine</h1>
        <p className="text-sm text-txt2">Check off your tasks for today</p>
      </div>

      {/* Time summary */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-txt3">Estimated:</span>
          <span className="text-bright font-mono">{formatMinutes(totalEst)}</span>
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-txt3">Remaining:</span>
          <span className="text-red-acc font-mono">{formatMinutes(remainEst)}</span>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm text-txt2">
            {checked}/{total} completed
          </span>
          <span className="text-sm font-mono text-red-acc">{pct}%</span>
        </div>
        <ProgressBar value={pct} height={10} />
      </div>

      {/* Task list */}
      <div className="space-y-2 mb-4">
        {tasks.map((task, idx) => (
          <div
            key={task.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            className={cn(
              "flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-3 group transition-all",
              dragIdx === idx && "opacity-50 scale-[0.98]",
              task.checked && "opacity-60"
            )}
          >
            {/* Drag handle */}
            <span className="cursor-grab text-txt3 opacity-0 group-hover:opacity-100 transition-opacity select-none">
              ⠿
            </span>

            {/* Checkbox */}
            <input
              type="checkbox"
              checked={task.checked || false}
              onChange={() => toggleCheck(task)}
            />

            {/* Name */}
            <span
              className={cn(
                "flex-1 text-sm",
                task.checked && "task-done"
              )}
            >
              {task.text}
            </span>

            {/* Est chip */}
            {task.est_minutes > 0 && (
              <span className="text-xs bg-surface2 text-txt3 px-2 py-0.5 rounded-full font-mono">
                {formatMinutes(task.est_minutes)}
              </span>
            )}

            {/* Menu */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(menuOpen === task.id ? null : task.id)}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface2 text-txt3 text-sm"
              >
                ⋯
              </button>
              {menuOpen === task.id && (
                <div className="absolute right-0 top-full mt-1 bg-surface2 border border-border rounded-lg shadow-xl py-1 w-32 z-20">
                  <button
                    onClick={() => openEdit(task)}
                    className="w-full text-left px-3 py-1.5 text-sm text-txt2 hover:bg-surface3 hover:text-txt"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => { removeTask(task.id); setMenuOpen(null); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-surface3"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {tasks.length === 0 && (
          <div className="text-center py-12 text-txt3">
            <p className="text-lg mb-2">No routine tasks yet</p>
            <p className="text-sm">Add your daily tasks to get started</p>
          </div>
        )}
      </div>

      {/* Add button */}
      <button
        onClick={openAdd}
        className="w-full bg-surface border border-dashed border-border2 rounded-lg px-4 py-3 text-sm text-txt3 hover:border-red-acc hover:text-red-acc transition-colors"
      >
        ＋ Add Task
      </button>

      {/* Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingTask(null); }}
        title={editingTask ? "Edit Task" : "Add Task"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Task name</label>
            <input
              type="text"
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveTask()}
              className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
              placeholder="e.g. Morning workout"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-txt2 mb-1.5">
              Estimated minutes
            </label>
            <input
              type="number"
              value={formEst}
              onChange={(e) => setFormEst(parseInt(e.target.value) || 0)}
              min={0}
              className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => { setModalOpen(false); setEditingTask(null); }}
              className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveTask}
              disabled={!formText.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-red-acc hover:bg-red-dark text-white transition-colors disabled:opacity-50"
            >
              {editingTask ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
