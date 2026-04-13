"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { WeeklyRoutineTask } from "@/lib/types";
import { formatMinutes, cn, getWeekKey, getMonday, formatDate, addDays } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import { Modal } from "@/components/Modal";
import { reorderRows } from "@/lib/db-helpers";
import { useToast } from "@/components/Toast";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { fetchWeeklyRoutineWithChecks } from "@/lib/queries";

export default function WeeklyRoutinePage() {
  const { toast } = useToast();
  const { userId, loading: authLoading } = useCurrentUser();
  const [tasks, setTasks] = useState<WeeklyRoutineTask[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<WeeklyRoutineTask | null>(null);
  const [formText, setFormText] = useState("");
  const [formEst, setFormEst] = useState(0);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen]);

  const weekKey = getWeekKey(new Date());
  const monday = getMonday(new Date());
  const sunday = addDays(monday, 6);
  const rangeLabel = `${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  // Days left in week
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysLeft = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

  const loadTasks = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();
      setTasks(await fetchWeeklyRoutineWithChecks(supabase, userId, weekKey));
    } catch (err) {
      console.error("Weekly routine load failed:", err);
      toast("Failed to load weekly routine", "error");
    }
  }, [weekKey, userId, toast]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const toggleCheck = async (task: WeeklyRoutineTask) => {
    const supabase = createClient();
    const newChecked = !task.checked;

    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, checked: newChecked } : t))
    );

    let error;
    if (newChecked) {
      ({ error } = await supabase.from("weekly_routine_checks").insert({
        user_id: userId,
        task_id: task.id,
        week_key: weekKey,
      }));
    } else {
      ({ error } = await supabase
        .from("weekly_routine_checks")
        .delete()
        .eq("task_id", task.id)
        .eq("week_key", weekKey));
    }
    if (error) {
      toast("Failed to save: " + error.message, "error");
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, checked: !newChecked } : t)));
    }
  };

  const saveTask = async () => {
    if (!formText.trim() || !userId) return;
    const supabase = createClient();

    if (editingTask) {
      const { error } = await supabase
        .from("weekly_routine_tasks")
        .update({ text: formText.trim(), est_minutes: formEst })
        .eq("id", editingTask.id);
      if (error) { toast("Failed to save: " + error.message, "error"); return; }
      setTasks((prev) => prev.map((t) => t.id === editingTask.id
        ? { ...t, text: formText.trim(), est_minutes: formEst } : t));
    } else {
      const { data: newTask, error } = await supabase.from("weekly_routine_tasks").insert({
        user_id: userId,
        text: formText.trim(),
        est_minutes: formEst,
        sort_order: tasks.length,
      }).select().single();
      if (error) { toast("Failed to save: " + error.message, "error"); return; }
      if (newTask) setTasks((prev) => [...prev, { ...newTask as WeeklyRoutineTask, checked: false }]);
    }

    setModalOpen(false);
    setEditingTask(null);
    setFormText("");
    setFormEst(0);
  };

  const removeTask = async (id: string) => {
    const supabase = createClient();
    await supabase.from("weekly_routine_tasks").delete().eq("id", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const openEdit = (task: WeeklyRoutineTask) => {
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
    if (!userId) return;
    const supabase = createClient();
    const { error } = await reorderRows(supabase, "weekly_routine_tasks", tasks.map((t) => t.id), userId);
    if (error) toast("Failed to reorder: " + error, "error");
  };

  const checked = tasks.filter((t) => t.checked).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  const totalEst = tasks.reduce((s, t) => s + t.est_minutes, 0);
  const remainEst = tasks.filter((t) => !t.checked).reduce((s, t) => s + t.est_minutes, 0);

  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
  useEffect(() => { setMonthlyEnabled(localStorage.getItem("comfy-monthly-routine") === "true"); }, []);

  const enableMonthly = () => {
    localStorage.setItem("comfy-monthly-routine", "true");
    setMonthlyEnabled(true);
    window.dispatchEvent(new Event("monthly-routine-changed"));
    toast("Monthly routine added to sidebar!", "success");
  };

  const disableMonthly = () => {
    localStorage.setItem("comfy-monthly-routine", "false");
    setMonthlyEnabled(false);
    window.dispatchEvent(new Event("monthly-routine-changed"));
    toast("Monthly routine removed from sidebar", "info");
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs text-txt3 uppercase tracking-wider mb-1">{rangeLabel} · {weekKey}</p>
          <h1 className="font-title text-2xl text-bright mb-1">Weekly Routine</h1>
          <p className="text-sm text-txt2">
            Tasks to complete this week
            {daysLeft > 0 ? ` · ${daysLeft} day${daysLeft > 1 ? "s" : ""} left` : " · Last day!"}
          </p>
        </div>
        {!monthlyEnabled ? (
          <button onClick={enableMonthly}
            className="px-3 py-1.5 rounded-lg text-xs border border-dashed border-violet/30 text-violet2 hover:bg-violet/10 transition-colors shrink-0">
            Need a monthly planner?
          </button>
        ) : (
          <button onClick={disableMonthly}
            className="px-3 py-1.5 rounded-lg text-xs border border-border text-txt3 hover:text-danger hover:border-danger/30 transition-colors shrink-0">
            Hide monthly routine
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 mb-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-txt3">Estimated:</span>
          <span className="text-bright font-mono">{formatMinutes(totalEst)}</span>
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-txt3">Remaining:</span>
          <span className="text-violet2 font-mono">{formatMinutes(remainEst)}</span>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm text-txt2">{checked}/{total} completed</span>
          <span className="text-sm font-mono text-violet2">{pct}%</span>
        </div>
        <ProgressBar value={pct} height={10} />
      </div>

      <div className="space-y-2 mb-4">
        {tasks.map((task, idx) => (
          <div key={task.id} draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            className={cn(
              "flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-3 group transition-all",
              dragIdx === idx && "opacity-50 scale-[0.98]",
              task.checked && "opacity-60"
            )}>
            <span className="cursor-grab text-txt3 opacity-0 group-hover:opacity-100 transition-opacity select-none">⠿</span>
            <input type="checkbox" checked={task.checked || false} onChange={() => toggleCheck(task)}
              className="accent-violet" />
            <span className={cn("flex-1 text-sm", task.checked && "task-done")}>{task.text}</span>
            {task.est_minutes > 0 && (
              <span className="text-xs bg-surface2 text-txt3 px-2 py-0.5 rounded-full font-mono">
                {formatMinutes(task.est_minutes)}
              </span>
            )}
            <div className="relative">
              <button onClick={() => setMenuOpen(menuOpen === task.id ? null : task.id)}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface2 text-txt3 text-sm">⋯</button>
              {menuOpen === task.id && (
                <div className="absolute right-0 top-full mt-1 bg-surface2 border border-border rounded-lg shadow-xl py-1 w-32 z-20">
                  <button onClick={() => openEdit(task)}
                    className="w-full text-left px-3 py-1.5 text-sm text-txt2 hover:bg-surface3 hover:text-txt">Edit</button>
                  <button onClick={() => { removeTask(task.id); setMenuOpen(null); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-surface3">Remove</button>
                </div>
              )}
            </div>
          </div>
        ))}

        {tasks.length === 0 && (
          <div className="text-center py-12 text-txt3">
            <p className="text-lg mb-2">No weekly tasks yet</p>
            <p className="text-sm">Add tasks that you need to complete each week</p>
          </div>
        )}
      </div>

      <button onClick={openAdd}
        className="w-full bg-surface border border-dashed border-border2 rounded-lg px-4 py-3 text-sm text-txt3 hover:border-violet hover:text-violet2 transition-colors">
        ＋ Add Weekly Task
      </button>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditingTask(null); }}
        title={editingTask ? "Edit Weekly Task" : "Add Weekly Task"}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Task name</label>
            <input type="text" value={formText} onChange={(e) => setFormText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveTask()}
              className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
              placeholder="e.g. Review weekly goals" autoFocus />
          </div>
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Estimated minutes</label>
            <input type="number" value={formEst} onChange={(e) => setFormEst(parseInt(e.target.value) || 0)}
              min={0} className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { setModalOpen(false); setEditingTask(null); }}
              className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3 transition-colors">Cancel</button>
            <button onClick={saveTask} disabled={!formText.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white transition-colors disabled:opacity-50">
              {editingTask ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
