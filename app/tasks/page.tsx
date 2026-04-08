"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { QuickTask } from "@/lib/types";
import { cn, toLocalDateStr } from "@/lib/utils";
import { GCalButton } from "@/components/GCalButton";

const PRIORITY_COLORS: Record<number, { border: string; bg: string; text: string; label: string }> = {
  1: { border: "#4ade80", bg: "rgba(74,222,128,0.06)", text: "#4ade80", label: "Low" },
  2: { border: "#34d399", bg: "rgba(52,211,153,0.06)", text: "#34d399", label: "Medium-Low" },
  3: { border: "#eab308", bg: "rgba(234,179,8,0.06)", text: "#eab308", label: "Medium" },
  4: { border: "#f97316", bg: "rgba(249,115,22,0.06)", text: "#f97316", label: "High" },
  5: { border: "#ef4444", bg: "rgba(239,68,68,0.08)", text: "#ef4444", label: "Critical" },
};

export default function TaskListPage() {
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [userId, setUserId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPriority, setNewPriority] = useState(3);
  const [newNotes, setNewNotes] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [newRecurrence, setNewRecurrence] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc" | "manual">("manual");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [now] = useState(new Date());

  const today = toLocalDateStr(now);

  const loadTasks = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    const { data } = await supabase.from("quick_tasks").select("*").eq("user_id", user.id).order("sort_order");
    setTasks(data || []);
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const addTask = async () => {
    if (!newName.trim()) return;
    const supabase = createClient();
    await supabase.from("quick_tasks").insert({
      user_id: userId, name: newName.trim(), priority: newPriority,
      notes: newNotes.trim(), date_key: newDate || null,
      deadline: newDeadline || null, recurrence: newRecurrence || null,
      sort_order: tasks.length,
    });

    // Also create a week_task if date is set
    if (newDate) {
      await supabase.from("week_tasks").insert({
        user_id: userId, date_key: newDate, text: newName.trim(),
        sort_order: 999, done: false,
      });
    }

    // Create deadline entry if deadline is set
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
    loadTasks();
  };

  const deleteTask = async (id: string) => {
    const supabase = createClient();
    await supabase.from("quick_tasks").delete().eq("id", id);
    setConfirmId(null);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const updateTask = async (id: string, field: string, value: string | number) => {
    const supabase = createClient();
    await supabase.from("quick_tasks").update({ [field]: value }).eq("id", id);
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, [field]: value } : t));
  };

  // Sort
  const sortedTasks = sortDir === "manual"
    ? tasks
    : [...tasks].sort((a, b) => sortDir === "asc" ? a.priority - b.priority : b.priority - a.priority);

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
    if (sortDir !== "manual") return;
    const supabase = createClient();
    await Promise.all(tasks.map((t, i) => supabase.from("quick_tasks").update({ sort_order: i }).eq("id", t.id)));
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
          <button onClick={() => setSortDir(sortDir === "asc" ? "desc" : sortDir === "desc" ? "manual" : "asc")}
            className={cn("px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors",
              sortDir === "manual" ? "border-border text-txt3" : "border-violet/30 text-violet2 bg-violet/10")}>
            {sortDir === "asc" ? "Priority ↑" : sortDir === "desc" ? "Priority ↓" : "Manual"}
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
            <label className="block text-[10px] text-txt3 uppercase tracking-wider mb-1">📅 Calendar date</label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-1.5 text-xs text-txt" />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] text-txt3 uppercase tracking-wider mb-1">⏳ Deadline</label>
            <input type="date" value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-1.5 text-xs text-txt" />
          </div>
          {newDeadline && (
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] text-txt3 uppercase tracking-wider mb-1">🔄 Recurring</label>
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

                  {/* Date/deadline info */}
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {task.date_key && (
                      <span className="text-[10px] text-violet2 bg-violet/10 px-1.5 py-0.5 rounded">
                        📅 {task.date_key}
                      </span>
                    )}
                    {task.deadline && (
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-mono",
                        isOverdue ? "text-red-400 bg-red-400/10" : "text-txt3 bg-surface3")}>
                        ⏳ {task.deadline}
                        {daysUntilDeadline !== null && (
                          <span className="ml-1">
                            {isOverdue ? `${Math.abs(daysUntilDeadline)}d late` : daysUntilDeadline === 0 ? "today" : `${daysUntilDeadline}d`}
                          </span>
                        )}
                      </span>
                    )}
                    {task.recurrence && (
                      <span className="text-[10px] text-txt3">🔄 {task.recurrence}</span>
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
