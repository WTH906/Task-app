"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { RoutineTask } from "@/lib/types";
import { formatMinutes, cn, formatDate } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import { Modal } from "@/components/Modal";
import { reorderRows } from "@/lib/db-helpers";
import { useToast } from "@/components/Toast";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { fetchRoutineWithChecks } from "@/lib/queries";
import { useLocale, dateLocale } from "@/lib/i18n/useLocale";

export default function RoutinePage() {
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const { userId, loading: authLoading } = useCurrentUser();
  const [tasks, setTasks] = useState<RoutineTask[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<RoutineTask | null>(null);
  const [formText, setFormText] = useState("");
  const [formEst, setFormEst] = useState(0);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Close menu on outside click
  useEffect(() => { document.title = `Comfy Board — ${t("routine.title")}`; }, [t]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen]);

  const today = formatDate(new Date());

  const loadTasks = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();
      setTasks(await fetchRoutineWithChecks(supabase, userId, today));
    } catch (err) {
      console.error("Routine load failed:", err);
      toast(t("toast.failedToLoad", { error: String(err) }), "error");
    }
  }, [today, userId, toast]);

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

    let error;
    if (newChecked) {
      ({ error } = await supabase.from("routine_checks").insert({
        user_id: userId,
        task_id: task.id,
        checked_date: today,
      }));
    } else {
      ({ error } = await supabase
        .from("routine_checks")
        .delete()
        .eq("task_id", task.id)
        .eq("checked_date", today));
    }
    if (error) {
      toast(t("toast.failedToSave", { error: error.message }), "error");
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, checked: !newChecked } : t)));
    }
  };

  const saveTask = async () => {
    if (!formText.trim() || !userId) return;
    const supabase = createClient();

    if (editingTask) {
      const { error } = await supabase
        .from("routine_tasks")
        .update({ text: formText.trim(), est_minutes: formEst })
        .eq("id", editingTask.id);
      if (error) { toast(t("toast.failedToSave", { error: error.message }), "error"); return; }
      setTasks((prev) => prev.map((t) => t.id === editingTask.id
        ? { ...t, text: formText.trim(), est_minutes: formEst } : t));
    } else {
      const { data: newTask, error } = await supabase.from("routine_tasks").insert({
        user_id: userId,
        text: formText.trim(),
        est_minutes: formEst,
        sort_order: tasks.length,
      }).select().single();
      if (error) { toast(t("toast.failedToSave", { error: error.message }), "error"); return; }
      if (newTask) setTasks((prev) => [...prev, { ...newTask as RoutineTask, checked: false }]);
    }

    setModalOpen(false);
    setEditingTask(null);
    setFormText("");
    setFormEst(0);
  };

  const removeTask = async (id: string) => {
    const supabase = createClient();
    await supabase.from("routine_tasks").delete().eq("id", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
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
    if (!userId) return;
    const supabase = createClient();
    const { error } = await reorderRows(supabase, "routine_tasks", tasks.map((t) => t.id), userId);
    if (error) toast(t("toast.failedToReorder", { error: String(error) }), "error");
  };

  const moveItem = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= tasks.length) return;
    const next = [...tasks];
    [next[idx], next[target]] = [next[target], next[idx]];
    setTasks(next);
    if (!userId) return;
    const { error } = await reorderRows(createClient(), "routine_tasks", next.map((t) => t.id), userId);
    if (error) toast(t("toast.failedToReorder", { error: String(error) }), "error");
  };

  const checked = tasks.filter((t) => t.checked).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  const totalEst = tasks.reduce((s, t) => s + t.est_minutes, 0);
  const remainEst = tasks.filter((t) => !t.checked).reduce((s, t) => s + t.est_minutes, 0);

  const dateObj = new Date();
  const dateStr = dateObj.toLocaleDateString(dateLocale(locale), {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="page-shell page-shell--list">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs text-txt3 uppercase tracking-wider mb-1">{dateStr}</p>
        <h1 className="font-title text-2xl text-bright mb-1">{t("routine.title")}</h1>
        <p className="text-sm text-txt2">{t("routine.subtitle")}</p>
      </div>

      {/* Time summary */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-txt3">{t("common.estimated")}</span>
          <span className="text-bright font-mono">{formatMinutes(totalEst)}</span>
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-txt3">{t("common.remaining")}</span>
          <span className="text-red-acc font-mono">{formatMinutes(remainEst)}</span>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm text-txt2">
            {checked}/{total} {t("common.completed")}
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
              "flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-3 group transition-all card-float",
              dragIdx === idx && "opacity-50 scale-[0.98]",
              task.checked && "opacity-60"
            )}
          >
            {/* Drag handle + keyboard reorder */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <span className="cursor-grab text-txt3 select-none">⠿</span>
              <div className="flex flex-col">
                <button type="button" aria-label="Move up" disabled={idx === 0}
                  onClick={() => { moveItem(idx, -1).catch(() => {}); }}
                  className="p-0.5 min-w-[24px] min-h-[20px] flex items-center justify-center text-txt3 hover:text-violet2 disabled:opacity-30 transition-colors rounded">
                  <span aria-hidden="true" className="text-[10px]">▲</span>
                </button>
                <button type="button" aria-label="Move down" disabled={idx === tasks.length - 1}
                  onClick={() => { moveItem(idx, 1).catch(() => {}); }}
                  className="p-0.5 min-w-[24px] min-h-[20px] flex items-center justify-center text-txt3 hover:text-violet2 disabled:opacity-30 transition-colors rounded">
                  <span aria-hidden="true" className="text-[10px]">▼</span>
                </button>
              </div>
            </div>

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
                type="button"
                onClick={() => setMenuOpen(menuOpen === task.id ? null : task.id)}
                aria-expanded={menuOpen === task.id}
                aria-label="Task actions"
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
                    {t("common.edit")}
                  </button>
                  <button
                    onClick={() => { removeTask(task.id); setMenuOpen(null); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-surface3"
                  >
                    {t("common.remove")}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {tasks.length === 0 && (
          <div className="text-center py-12 text-txt3">
            <p className="text-lg mb-2">{t("routine.empty")}</p>
            <p className="text-sm">{t("routine.emptyHint")}</p>
          </div>
        )}
      </div>

      {/* Add button */}
      <button
        onClick={openAdd}
        className="w-full bg-surface border border-dashed border-border2 rounded-lg px-4 py-3 text-sm text-txt3 hover:border-red-acc hover:text-red-acc transition-colors"
      >
        ＋ {t("routine.addTask")}
      </button>

      {/* Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingTask(null); }}
        title={editingTask ? t("routine.editTask") : t("routine.addTask")}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-txt2 mb-1.5">{t("routine.taskName")}</label>
            <input
              type="text"
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveTask()}
              className="w-full glass-field px-3 py-2 text-txt text-sm"
              placeholder={t("routine.placeholder")}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-txt2 mb-1.5">{t("routine.estimatedTime")}</label>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <input type="number" value={Math.floor(formEst / 60) || ""} onChange={(e) => { const h = parseInt(e.target.value) || 0; setFormEst(Math.max(0, h * 60 + (formEst % 60))); }}
                  onFocus={(e) => { if (e.target.value === "0") e.target.value = ""; e.target.select(); }} min={0} placeholder="0"
                  className="w-16 glass-field px-3 py-2 text-txt text-sm" />
                <span className="text-xs text-txt3">h</span>
              </div>
              <div className="flex items-center gap-1">
                <input type="number" value={formEst % 60 || ""} onChange={(e) => { const m = Math.min(59, Math.max(0, parseInt(e.target.value) || 0)); setFormEst(Math.floor(formEst / 60) * 60 + m); }}
                  onFocus={(e) => { if (e.target.value === "0") e.target.value = ""; e.target.select(); }} min={0} max={59} placeholder="0"
                  className="w-16 glass-field px-3 py-2 text-txt text-sm" />
                <span className="text-xs text-txt3">min</span>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => { setModalOpen(false); setEditingTask(null); }}
              className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3 transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={saveTask}
              disabled={!formText.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-red-acc hover:bg-red-dark text-white transition-colors disabled:opacity-50"
            >
              {editingTask ? t("common.save") : t("common.add")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
