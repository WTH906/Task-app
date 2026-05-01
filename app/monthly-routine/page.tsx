"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { MonthlyRoutineTask } from "@/lib/types";
import { formatMinutes, cn, getMonthKey } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import { Modal } from "@/components/Modal";
import { reorderRows } from "@/lib/db-helpers";
import { useToast } from "@/components/Toast";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { fetchMonthlyRoutineWithChecks } from "@/lib/queries";
import { CalendarDays } from "lucide-react";

export default function MonthlyRoutinePage() {
  const { toast } = useToast();
  const { userId, loading: authLoading } = useCurrentUser();
  const [tasks, setTasks] = useState<MonthlyRoutineTask[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<MonthlyRoutineTask | null>(null);
  const [formText, setFormText] = useState("");
  const [formEst, setFormEst] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const monthKey = getMonthKey(new Date());
  const now = new Date();
  const monthName = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate();

  const loadTasks = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();
      setTasks(await fetchMonthlyRoutineWithChecks(supabase, userId, monthKey));
    } catch {
      toast("Failed to load monthly routine", "error");
    }
  }, [userId, monthKey, toast]);

  useEffect(() => { document.title = "Comfy Board — Monthly Routine"; }, []);

  useEffect(() => { if (!authLoading && userId) loadTasks(); }, [authLoading, userId, loadTasks]);

  const toggleCheck = async (task: MonthlyRoutineTask) => {
    const supabase = createClient();
    const newChecked = !task.checked;
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, checked: newChecked } : t));
    if (newChecked) {
      const { error } = await supabase.from("monthly_routine_checks").insert({ user_id: userId, task_id: task.id, month_key: monthKey });
      if (error) { toast("Failed to save", "error"); setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, checked: !newChecked } : t)); }
    } else {
      const { error } = await supabase.from("monthly_routine_checks").delete().eq("task_id", task.id).eq("month_key", monthKey);
      if (error) { toast("Failed to save", "error"); setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, checked: !newChecked } : t)); }
    }
  };

  const saveTask = async () => {
    if (!formText.trim()) return;
    const supabase = createClient();
    if (editingTask) {
      const { error } = await supabase.from("monthly_routine_tasks").update({ text: formText.trim(), est_minutes: formEst }).eq("id", editingTask.id);
      if (error) { toast("Failed to save: " + error.message, "error"); return; }
      setTasks((prev) => prev.map((t) => t.id === editingTask.id
        ? { ...t, text: formText.trim(), est_minutes: formEst } : t));
    } else {
      const { data: newTask, error } = await supabase.from("monthly_routine_tasks").insert({
        user_id: userId, text: formText.trim(), est_minutes: formEst, sort_order: tasks.length,
      }).select().single();
      if (error) { toast("Failed to save: " + error.message, "error"); return; }
      if (newTask) setTasks((prev) => [...prev, { ...newTask as MonthlyRoutineTask, checked: false }]);
    }
    setModalOpen(false);
    setEditingTask(null);
    setFormText("");
    setFormEst(0);
  };

  const deleteTask = async (id: string) => {
    if (!confirm("Delete this task?")) return;
    const supabase = createClient();
    await supabase.from("monthly_routine_tasks").delete().eq("id", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

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
    await reorderRows(supabase, "monthly_routine_tasks", tasks.map((t) => t.id), userId);
  };

  const checked = tasks.filter((t) => t.checked).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  const totalEst = tasks.reduce((s, t) => s + t.est_minutes, 0);
  const checkedEst = tasks.filter((t) => t.checked).reduce((s, t) => s + t.est_minutes, 0);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="font-title text-2xl text-bright flex items-center gap-2">
            <CalendarDays size={22} /> Monthly Routine
          </h1>
          <p className="text-sm text-txt2 mt-0.5">{monthName} · {daysLeft} days left</p>
        </div>
        <button onClick={() => { setEditingTask(null); setFormText(""); setFormEst(0); setModalOpen(true); }}
          className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white transition-colors">
          ＋ Add Task
        </button>
      </div>

      <div className="flex items-center gap-4 mb-4 text-xs text-txt3">
        <span>{checked}/{total} completed</span>
        <span>{formatMinutes(checkedEst)} / {formatMinutes(totalEst)} estimated</span>
      </div>
      <ProgressBar value={pct} height={10} showLabel />

      <div className="mt-6 space-y-2">
        {tasks.map((task, idx) => (
          <div key={task.id} draggable onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)} onDragEnd={handleDragEnd}
            className={cn("bg-surface border border-border rounded-lg px-4 py-3 flex items-center gap-3 group transition-all",
              dragIdx === idx && "opacity-50 scale-[0.98]")}>
            <span className="cursor-grab text-txt3 opacity-0 group-hover:opacity-100 select-none">⠿</span>
            <input type="checkbox" checked={task.checked || false} onChange={() => toggleCheck(task)}
              className="w-4 h-4 shrink-0 accent-violet" />
            <div className="flex-1 min-w-0">
              <p className={cn("text-sm", task.checked && "line-through text-txt3 opacity-60")}>{task.text}</p>
              {task.est_minutes > 0 && <p className="text-[10px] text-txt3 font-mono">{formatMinutes(task.est_minutes)}</p>}
            </div>
            <div className="relative">
              <button onClick={() => { setEditingTask(task); setFormText(task.text); setFormEst(task.est_minutes); setModalOpen(true); }}
                className="text-xs text-txt3 opacity-0 group-hover:opacity-100 hover:text-violet2 transition-all px-1">Edit</button>
              <button onClick={() => deleteTask(task.id)}
                className="text-xs text-txt3 opacity-0 group-hover:opacity-100 hover:text-danger transition-all px-1">✕</button>
            </div>
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="text-center py-16 text-txt3">
            <p className="text-4xl mb-3 opacity-30">📅</p>
            <p className="text-lg font-medium text-txt2 mb-1">No monthly tasks yet</p>
            <p className="text-sm">Add recurring monthly tasks like reviews, reports, or check-ins</p>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingTask ? "Edit Task" : "Add Monthly Task"}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Task</label>
            <input type="text" value={formText} onChange={(e) => setFormText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveTask()}
              className="w-full bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-txt text-sm" autoFocus />
          </div>
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Estimated time</label>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <input type="number" value={Math.floor(formEst / 60) || ""} onChange={(e) => { const h = parseInt(e.target.value) || 0; setFormEst(Math.max(0, h * 60 + (formEst % 60))); }}
                  onFocus={(e) => { if (e.target.value === "0") e.target.value = ""; e.target.select(); }} min={0} placeholder="0"
                  className="w-16 bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-txt text-sm" />
                <span className="text-xs text-txt3">h</span>
              </div>
              <div className="flex items-center gap-1">
                <input type="number" value={formEst % 60 || ""} onChange={(e) => { const m = Math.min(59, Math.max(0, parseInt(e.target.value) || 0)); setFormEst(Math.floor(formEst / 60) * 60 + m); }}
                  onFocus={(e) => { if (e.target.value === "0") e.target.value = ""; e.target.select(); }} min={0} max={59} placeholder="0"
                  className="w-16 bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-txt text-sm" />
                <span className="text-xs text-txt3">min</span>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3">Cancel</button>
            <button onClick={saveTask} disabled={!formText.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white disabled:opacity-50">Save</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
