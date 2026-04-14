"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { QuickTask } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { GCalButton } from "@/components/GCalButton";
import { reorderRows } from "@/lib/db-helpers";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { fetchQuickTasks } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { CalendarDays, Timer, RefreshCw } from "lucide-react";

const PRIORITY_COLORS: Record<number, { border: string; bg: string; text: string; label: string }> = {
  1: { border: "#4ade80", bg: "rgba(74,222,128,0.06)", text: "#4ade80", label: "Low" },
  2: { border: "#34d399", bg: "rgba(52,211,153,0.06)", text: "#34d399", label: "Medium-Low" },
  3: { border: "#eab308", bg: "rgba(234,179,8,0.06)", text: "#eab308", label: "Medium" },
  4: { border: "#f97316", bg: "rgba(249,115,22,0.06)", text: "#f97316", label: "High" },
  5: { border: "#ef4444", bg: "rgba(239,68,68,0.08)", text: "#ef4444", label: "Critical" },
};

export default function TaskListPage() {
  const { userId, loading: authLoading } = useCurrentUser();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [newName, setNewName] = useState("");
  const [newPriority, setNewPriority] = useState(3);
  const [newNotes, setNewNotes] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [newRecurrence, setNewRecurrence] = useState("");
  const [sortDir, setSortDir] = useState<"manual" | "priority-asc" | "priority-desc" | "date-asc" | "date-desc">("manual");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [now] = useState(new Date());

  const today = formatDate(now);

  const loadTasks = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();
      setTasks(await fetchQuickTasks(supabase, userId));
    } catch (err) {
      console.error("Tasks load failed:", err);
      toast("Failed to load tasks", "error");
    }
  }, [userId, toast]);

  useEffect(() => { document.title = "Comfy Board — Task List"; }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const addTask = async () => {
    if (!newName.trim()) return;
    const supabase = createClient();
    const { data: newTask, error } = await supabase.from("quick_tasks").insert({
      user_id: userId, name: newName.trim(), priority: newPriority,
      notes: newNotes.trim(), date_key: newDate || null,
      deadline: newDeadline || null, recurrence: newRecurrence || null,
      sort_order: tasks.length,
    }).select().single();

    if (error || !newTask) return;
    setTasks((prev) => [...prev, newTask as QuickTask]);

    if (newDate) {
      await supabase.from("week_tasks").insert({
        user_id: userId, date_key: newDate, text: newName.trim(),
        sort_order: 999, done: false,
      });
    }

    if (newDeadline) {
      await supabase.from("deadlines").insert({
        user_id: userId,
        label: newName.trim(),
        target_datetime: `${newDeadline}T23:59:00`,
        recurrence: newRecurrence || null,
      });
    }

    setNewName(""); setNewPriority(3); setNewNotes("");
    setNewDate(""); setNewDeadline(""); setNewRecurrence("");
  };

  const deleteTask = async (id: string) => {
    const supabase = createClient();
    const task = tasks.find((t) => t.id === id);
    await supabase.from("quick_tasks").delete().eq("id", id);
    setConfirmId(null);
    setTasks((prev) => prev.filter((t) => t.id !== id));

    // Clean up linked week_task
    if (task?.date_key) {
      await supabase.from("week_tasks").delete()
        .eq("user_id", userId).eq("text", task.name).eq("date_key", task.date_key);
    }
    // Clean up linked deadline
    if (task?.deadline) {
      await supabase.from("deadlines").delete()
        .eq("user_id", userId).eq("label", task.name);
    }
  };

  const updateTask = async (id: string, field: string, value: string | number | null) => {
    const supabase = createClient();
    const dbValue = value === "" ? null : value;
    await supabase.from("quick_tasks").update({ [field]: dbValue }).eq("id", id);
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, [field]: dbValue } : t));
  };

  // Sort
  const sortedTasks = (() => {
    if (sortDir === "manual") return tasks;
    if (sortDir === "priority-asc") return [...tasks].sort((a, b) => a.priority - b.priority);
    if (sortDir === "priority-desc") return [...tasks].sort((a, b) => b.priority - a.priority);
    // Date sorting — tasks without dates go to the end
    const noDate = "9999-99-99";
    if (sortDir === "date-asc") return [...tasks].sort((a, b) => (a.date_key || a.deadline || noDate).localeCompare(b.date_key || b.deadline || noDate));
    if (sortDir === "date-desc") return [...tasks].sort((a, b) => (b.date_key || b.deadline || "").localeCompare(a.date_key || a.deadline || ""));
    return tasks;
  })();

  // Drag
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx || sortDir !== "manual") return;
    const newTasks = [...tasks];
    const [moved] = newTasks.splice(dragIdx, 1);
    newTasks.splice(idx, 0, moved);
    setTasks(newTasks);
    setDragIdx(idx);
  };
  const handleDragEnd = async () => {
    setDragIdx(null);
    if (sortDir !== "manual" || !userId) return;
    const supabase = createClient();
    await reorderRows(supabase, "quick_tasks", tasks.map((t) => t.id), userId);
  };

  // Stats
  const totalTasks = tasks.length;
  const criticalCount = tasks.filter((t) => t.priority >= 4).length;
  const withDeadline = tasks.filter((t) => t.deadline).length;

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="font-title text-2xl text-bright">Task List</h1>
          <p className="text-sm text-txt2 mt-0.5">Quick tasks, appointments & reminders — no project needed</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSortDir(sortDir === "priority-asc" ? "priority-desc" : sortDir === "priority-desc" ? "manual" : "priority-asc")}
            className={cn("px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors",
              sortDir.startsWith("priority") ? "border-violet/30 text-violet2 bg-violet/10" : "border-border text-txt3")}>
            {sortDir === "priority-asc" ? "Priority ↑" : sortDir === "priority-desc" ? "Priority ↓" : "Priority"}
          </button>
          <button onClick={() => setSortDir(sortDir === "date-asc" ? "date-desc" : sortDir === "date-desc" ? "manual" : "date-asc")}
            className={cn("px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors",
              sortDir.startsWith("date") ? "border-violet/30 text-violet2 bg-violet/10" : "border-border text-txt3")}>
            {sortDir === "date-asc" ? "Date ↑" : sortDir === "date-desc" ? "Date ↓" : "Date"}
          </button>
        </div>
      </div>

      {/* Stats */}
      {totalTasks > 0 && (
        <div className="flex items-center gap-3 mb-4 text-xs text-txt3">
          <span>{totalTasks} tasks</span>
          {criticalCount > 0 && <span className="text-red-400">{criticalCount} high priority</span>}
          {withDeadline > 0 && <span>{withDeadline} with deadlines</span>}
        </div>
      )}

      {/* Add form */}
      <div className="bg-surface border border-border rounded-xl p-4 mb-6 space-y-3">
        <div className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="Task name..."
            className="flex-1 bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder-txt3" autoFocus />
          <select value={newPriority} onChange={(e) => setNewPriority(parseInt(e.target.value))}
            className="bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-txt">
            {[1,2,3,4,5].map((p) => (
              <option key={p} value={p}>P{p} — {PRIORITY_COLORS[p].label}</option>
            ))}
          </select>
        </div>
        <input value={newNotes} onChange={(e) => setNewNotes(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="Short note (optional)..."
          className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-txt placeholder-txt3" />
        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] text-txt3 uppercase tracking-wider mb-1 flex items-center gap-1"><CalendarDays size={10} /> Calendar date</label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-1.5 text-xs text-txt" />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] text-txt3 uppercase tracking-wider mb-1 flex items-center gap-1"><Timer size={10} /> Deadline</label>
            <input type="date" value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-1.5 text-xs text-txt" />
          </div>
          {newDeadline && (
            <div className="flex-1 min-w-[140px]">
              <label className="text-[10px] text-txt3 uppercase tracking-wider mb-1 flex items-center gap-1"><RefreshCw size={10} /> Recurring</label>
              <select value={newRecurrence} onChange={(e) => setNewRecurrence(e.target.value)}
                className="w-full bg-surface2 border border-border rounded-lg px-3 py-1.5 text-xs text-txt">
                <option value="">No</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <button onClick={addTask} disabled={!newName.trim()}
            className="px-5 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white disabled:opacity-50 transition-colors">
            Add Task
          </button>
        </div>
      </div>

      {/* Tasks */}
      <div className="space-y-2">
        {sortedTasks.map((task, idx) => {
          const pc = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[3];
          const daysUntilDeadline = task.deadline
            ? Math.ceil((new Date(task.deadline + "T23:59:00").getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : null;
          const isOverdue = daysUntilDeadline !== null && daysUntilDeadline < 0;

          return (
            <div key={task.id}
              draggable={sortDir === "manual"}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={cn(
                "rounded-xl p-4 group transition-all border-2",
                dragIdx === idx && "opacity-50 scale-[0.98]"
              )}
              style={{
                borderColor: pc.border,
                backgroundColor: pc.bg,
              }}>
              <div className="flex items-start gap-3">
                {sortDir === "manual" && (
                  <span className="cursor-grab text-txt3 opacity-30 group-hover:opacity-100 transition-opacity select-none mt-0.5 shrink-0">⠿</span>
                )}

                <div className="flex-1 min-w-0">
                  {editingId === task.id ? (
                    <input value={task.name}
                      onChange={(e) => setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, name: e.target.value } : t))}
                      onBlur={() => { updateTask(task.id, "name", task.name); setEditingId(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { updateTask(task.id, "name", task.name); setEditingId(null); } }}
                      className="text-sm font-medium text-bright bg-transparent border-b border-violet outline-none w-full"
                      autoFocus />
                  ) : (
                    <p className="text-sm font-medium text-bright cursor-pointer hover:underline"
                      onClick={() => setEditingId(task.id)}>{task.name}</p>
                  )}
                  {task.notes && <p className="text-xs text-txt3 mt-0.5">{task.notes}</p>}

                  {/* Date/deadline info — editable */}
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <label className="text-[10px] text-violet2 bg-violet/10 px-1.5 py-0.5 rounded inline-flex items-center gap-1 cursor-pointer">
                      <CalendarDays size={10} />
                      <input type="date" value={task.date_key || ""}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, date_key: val } : t));
                          updateTask(task.id, "date_key", val || "");
                        }}
                        className="bg-transparent border-none text-[10px] text-violet2 w-[105px] outline-none cursor-pointer"
                        title="Calendar date" />
                      {task.date_key && (
                        <button onClick={(e) => { e.stopPropagation(); updateTask(task.id, "date_key", ""); setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, date_key: null } : t)); }}
                          className="text-violet2/50 hover:text-violet2 text-[10px]">✕</button>
                      )}
                    </label>
                    <label className={cn("text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 cursor-pointer",
                      isOverdue ? "text-red-400 bg-red-400/10" : "text-txt3 bg-surface3")}>
                      <Timer size={10} />
                      <input type="date" value={task.deadline || ""}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, deadline: val } : t));
                          updateTask(task.id, "deadline", val || "");
                        }}
                        className="bg-transparent border-none text-[10px] w-[105px] outline-none cursor-pointer"
                        style={{ color: "inherit" }}
                        title="Deadline" />
                      {task.deadline && daysUntilDeadline !== null && (
                        <span className="text-[10px]">
                          {isOverdue ? `${Math.abs(daysUntilDeadline)}d late` : daysUntilDeadline === 0 ? "today" : `${daysUntilDeadline}d`}
                        </span>
                      )}
                    </label>
                    {task.recurrence && (
                      <span className="text-[10px] text-txt3 inline-flex items-center gap-1"><RefreshCw size={10} /> {task.recurrence}</span>
                    )}
                  </div>
                </div>

                {/* Priority badge */}
                <span className="text-[10px] font-bold px-2 py-1 rounded shrink-0"
                  style={{ color: pc.text, backgroundColor: `${pc.border}15` }}>
                  P{task.priority}
                </span>

                {/* Priority changer */}
                <select value={task.priority}
                  onChange={(e) => updateTask(task.id, "priority", parseInt(e.target.value))}
                  className="bg-transparent border-none text-[10px] text-txt3 opacity-0 group-hover:opacity-100 transition-opacity w-8 shrink-0">
                  {[1,2,3,4,5].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>

                <GCalButton title={task.name} date={task.date_key || task.deadline} description={task.notes} />

                <button onClick={() => setConfirmId(task.id)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border text-txt3 opacity-0 group-hover:opacity-100 hover:border-green-acc hover:text-green-acc hover:bg-green-acc/10 transition-all shrink-0"
                  style={{ borderColor: pc.border + "40" }}>
                  Done ✓
                </button>
              </div>
            </div>
          );
        })}

        {tasks.length === 0 && (
          <div className="text-center py-16 text-txt3">
            <p className="text-4xl mb-3 opacity-30">📝</p>
            <p className="text-lg font-medium text-txt2 mb-1">No tasks yet</p>
            <p className="text-sm">Dump quick tasks, appointments, and reminders here</p>
          </div>
        )}
      </div>

      {/* Confirm delete modal */}
      {confirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmId(null); }}>
          <div className="bg-surface2 border border-border rounded-xl p-6 max-w-sm w-full shadow-2xl text-center">
            <p className="text-lg font-title text-bright mb-2">Task completed?</p>
            <p className="text-sm text-txt2 mb-6">This will permanently remove the task.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setConfirmId(null)}
                className="px-5 py-2 rounded-lg text-sm border border-border text-txt2 hover:bg-surface3 transition-colors">
                No, keep it
              </button>
              <button onClick={() => deleteTask(confirmId)}
                className="px-5 py-2 rounded-lg text-sm bg-green-acc/20 border border-green-acc/40 text-green-acc hover:bg-green-acc/30 transition-colors">
                Yes, done!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
