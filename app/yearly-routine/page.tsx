"use client";

import { useEffect, useState, useCallback } from "react";
import { formatMinutes, cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { useToast } from "@/components/Toast";
import { createClient } from "@/lib/supabase";
import { YearlyRoutineTask } from "@/lib/types";
import { Modal } from "@/components/Modal";
import { Plus } from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function YearlyRoutinePage() {
  const { userId, loading } = useCurrentUser();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<YearlyRoutineTask[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<YearlyRoutineTask | null>(null);
  const [formText, setFormText] = useState("");
  const [formEst, setFormEst] = useState(0);
  const [formMonthFrom, setFormMonthFrom] = useState<number | null>(null);
  const [formMonthTo, setFormMonthTo] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const currentYear = new Date().getFullYear();

  const loadTasks = useCallback(async () => {
    if (!userId) return;
    const supabase = createClient();

    const { data: taskData } = await supabase
      .from("yearly_routine_tasks")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order");

    const { data: checks } = await supabase
      .from("yearly_routine_checks")
      .select("task_id, checked")
      .eq("user_id", userId)
      .eq("year", currentYear);

    const checkMap: Record<string, boolean> = {};
    for (const c of checks || []) checkMap[c.task_id] = c.checked;

    const merged = (taskData || []).map(t => ({
      ...t,
      checked: checkMap[t.id] || false,
    })) as YearlyRoutineTask[];

    setTasks(merged);
    setDataLoading(false);
  }, [userId, currentYear]);

  useEffect(() => {
    if (!loading) loadTasks();
  }, [loadTasks, loading]);

  useEffect(() => { document.title = "Comfy Board — Yearly Routine"; }, []);

  const toggleCheck = async (task: YearlyRoutineTask) => {
    const supabase = createClient();
    const newChecked = !task.checked;
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, checked: newChecked } : t));

    await supabase.from("yearly_routine_checks").upsert({
      user_id: userId!, task_id: task.id, year: currentYear,
      checked: newChecked, checked_at: newChecked ? new Date().toISOString() : null,
    }, { onConflict: "user_id,task_id,year" });
  };

  const saveTask = async () => {
    if (!formText.trim() || !userId) return;
    const supabase = createClient();

    if (editingTask) {
      await supabase.from("yearly_routine_tasks")
        .update({ text: formText.trim(), est_minutes: formEst, month_from: formMonthFrom, month_to: formMonthTo })
        .eq("id", editingTask.id);
      setTasks(prev => prev.map(t => t.id === editingTask.id
        ? { ...t, text: formText.trim(), est_minutes: formEst, month_from: formMonthFrom, month_to: formMonthTo } : t));
    } else {
      const { data: newTask } = await supabase.from("yearly_routine_tasks").insert({
        user_id: userId, text: formText.trim(), est_minutes: formEst,
        month_from: formMonthFrom, month_to: formMonthTo, sort_order: tasks.length,
      }).select().single();
      if (newTask) setTasks(prev => [...prev, { ...newTask as YearlyRoutineTask, checked: false }]);
    }
    closeModal();
  };

  const closeModal = () => {
    setModalOpen(false); setEditingTask(null);
    setFormText(""); setFormEst(0); setFormMonthFrom(null); setFormMonthTo(null);
  };

  const openEdit = (task: YearlyRoutineTask) => {
    setEditingTask(task); setFormText(task.text); setFormEst(task.est_minutes);
    setFormMonthFrom(task.month_from); setFormMonthTo(task.month_to);
    setModalOpen(true);
  };

  const openAdd = () => {
    setEditingTask(null); setFormText(""); setFormEst(0);
    setFormMonthFrom(null); setFormMonthTo(null); setModalOpen(true);
  };

  const deleteTask = async (id: string) => {
    if (!confirm("Remove this task?")) return;
    const supabase = createClient();
    await supabase.from("yearly_routine_tasks").delete().eq("id", id);
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setTasks(prev => {
      const copy = [...prev];
      const [item] = copy.splice(dragIdx!, 1);
      copy.splice(idx, 0, item);
      return copy;
    });
    setDragIdx(idx);
  };

  const handleDragEnd = async () => {
    setDragIdx(null);
    if (!userId) return;
    const supabase = createClient();
    tasks.forEach((t, i) => supabase.from("yearly_routine_tasks").update({ sort_order: i }).eq("id", t.id));
  };

  if (loading || dataLoading) return <div className="p-8 text-txt3">Loading...</div>;

  const done = tasks.filter(t => t.checked).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const totalEst = tasks.reduce((s, t) => s + t.est_minutes, 0);
  const remainEst = tasks.filter(t => !t.checked).reduce((s, t) => s + t.est_minutes, 0);
  const currentMonth = new Date().getMonth() + 1;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs text-violet2 mb-1">{currentYear}</p>
          <h1 className="text-3xl font-title text-bright mb-1">Yearly Routine</h1>
          <p className="text-txt2 text-sm">Tasks to complete this year</p>
        </div>
      </div>

      <div className="flex gap-6 text-sm text-txt2 mb-3">
        <span>Estimated: <strong className="text-bright">{formatMinutes(totalEst)}</strong></span>
        <span>Remaining: <strong className="text-red-acc">{formatMinutes(remainEst)}</strong></span>
      </div>

      <div className="mb-6">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-txt2">{done}/{total} completed</span>
          <span className="text-red-acc">{pct}%</span>
        </div>
        <ProgressBar value={pct} height={8} />
      </div>

      <button onClick={openAdd}
        className="w-full border border-dashed border-border2 rounded-lg px-4 py-2.5 text-sm text-txt3 hover:border-violet hover:text-violet transition-colors mb-3">
        ＋ Add Task
      </button>

      {/* Task list */}
      <div className="space-y-2 mb-4">
        {tasks.map((task, idx) => {
          // Highlight tasks whose month range includes current month
          const isCurrentPeriod = task.month_from && task.month_to
            ? (task.month_from <= task.month_to
              ? currentMonth >= task.month_from && currentMonth <= task.month_to
              : currentMonth >= task.month_from || currentMonth <= task.month_to)
            : task.month_from ? currentMonth >= task.month_from : task.month_to ? currentMonth <= task.month_to : false;

          return (
            <div key={task.id}
              draggable onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => handleDragOver(e, idx)} onDragEnd={handleDragEnd}
              className={cn(
                "flex items-center gap-3 bg-surface border rounded-lg px-4 py-3 group card-float transition-colors",
                isCurrentPeriod && !task.checked ? "border-violet/50" : "border-border",
                dragIdx === idx && "opacity-50 scale-[0.98]")}>
              <span className="cursor-grab text-txt3 opacity-0 group-hover:opacity-100 select-none">⠿</span>
              <input type="checkbox" checked={task.checked || false} onChange={() => toggleCheck(task)}
                className="w-4 h-4 shrink-0 accent-violet" />
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm", task.checked && "line-through text-txt3 opacity-60")}>{task.text}</p>
                {task.est_minutes > 0 && <p className="text-[10px] text-txt3 font-mono">{formatMinutes(task.est_minutes)}</p>}
              </div>
              {(task.month_from || task.month_to) && (
                <span className="text-xs text-violet2 bg-violet/10 px-2 py-0.5 rounded-md font-medium shrink-0">
                  {task.month_from && task.month_to
                    ? `${MONTHS[task.month_from - 1].slice(0, 3)} – ${MONTHS[task.month_to - 1].slice(0, 3)}`
                    : task.month_from
                    ? `From ${MONTHS[task.month_from - 1].slice(0, 3)}`
                    : `Until ${MONTHS[task.month_to! - 1].slice(0, 3)}`}
                </span>
              )}
              <div className="relative">
                <button onClick={() => openEdit(task)}
                  className="text-xs text-txt3 opacity-0 group-hover:opacity-100 hover:text-violet2 transition-all px-1">Edit</button>
                <button onClick={() => deleteTask(task.id)}
                  className="text-xs text-txt3 opacity-0 group-hover:opacity-100 hover:text-danger transition-all px-1">✕</button>
              </div>
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div className="text-center py-16 text-txt3">
            <p className="text-4xl mb-3 opacity-30">📆</p>
            <p className="text-lg font-medium text-txt2 mb-1">No yearly tasks yet</p>
            <p className="text-sm">Add tasks for things you do once a year — tax filing, renewals, annual reviews...</p>
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal open={modalOpen} onClose={closeModal} title={editingTask ? "Edit Yearly Task" : "Add Yearly Task"}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Task name</label>
            <input autoFocus value={formText} onChange={e => setFormText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveTask()}
              placeholder="e.g. File annual taxes"
              className="w-full glass-field px-3 py-2 text-txt text-sm" />
          </div>
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Estimated time (minutes)</label>
            <input type="number" value={formEst || ""} onChange={e => setFormEst(parseInt(e.target.value) || 0)}
              className="w-20 glass-field px-3 py-2 text-txt text-sm" />
          </div>
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Month range (optional)</label>
            <div className="flex items-center gap-2">
              <select value={formMonthFrom || ""} onChange={e => setFormMonthFrom(parseInt(e.target.value) || null)}
                className="flex-1 glass-field px-3 py-2 text-txt text-sm">
                <option value="">Any month</option>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <span className="text-xs text-txt3">to</span>
              <select value={formMonthTo || ""} onChange={e => setFormMonthTo(parseInt(e.target.value) || null)}
                className="flex-1 glass-field px-3 py-2 text-txt text-sm">
                <option value="">Any month</option>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            {formMonthFrom && formMonthTo && (
              <p className="text-[10px] text-txt3 mt-1">
                Do between {MONTHS[formMonthFrom - 1]} and {MONTHS[formMonthTo - 1]} each year
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={closeModal} className="px-4 py-2 rounded-lg text-sm text-txt3 hover:bg-surface3">Cancel</button>
            <button onClick={saveTask} disabled={!formText.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-violet text-white hover:opacity-90 disabled:opacity-40">
              {editingTask ? "Save" : "Add Task"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
