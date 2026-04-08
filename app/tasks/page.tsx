"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { QuickTask } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GCalButton } from "@/components/GCalButton";

const PRIORITY_COLORS: Record<number, { bg: string; border: string; text: string; label: string }> = {
  1: { bg: "bg-green-acc/10", border: "border-green-acc/40", text: "text-green-acc", label: "Low" },
  2: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-400", label: "Medium-Low" },
  3: { bg: "bg-yellow-500/10", border: "border-yellow-500/40", text: "text-yellow-400", label: "Medium" },
  4: { bg: "bg-orange-500/10", border: "border-orange-500/40", text: "text-orange-400", label: "High" },
  5: { bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-400", label: "Critical" },
};

const PRIORITY_BORDER_STYLES: Record<number, string> = {
  1: "#4ade80",
  2: "#34d399",
  3: "#eab308",
  4: "#f97316",
  5: "#ef4444",
};

export default function TaskListPage() {
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [userId, setUserId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPriority, setNewPriority] = useState(3);
  const [newNotes, setNewNotes] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc" | "manual">("manual");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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
      notes: newNotes.trim(), sort_order: tasks.length,
    });
    setNewName("");
    setNewPriority(3);
    setNewNotes("");
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
    const updates = tasks.map((t, i) => supabase.from("quick_tasks").update({ sort_order: i }).eq("id", t.id));
    await Promise.all(updates);
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-title text-2xl text-bright">Task List</h1>
          <p className="text-sm text-txt2 mt-0.5">Quick tasks, appointments & reminders</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-txt3 uppercase">Sort:</span>
          <button onClick={() => setSortDir(sortDir === "asc" ? "desc" : sortDir === "desc" ? "manual" : "asc")}
            className={cn("px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors",
              sortDir === "manual" ? "border-border text-txt3" : "border-violet/30 text-violet2 bg-violet/10")}>
            {sortDir === "asc" ? "Priority ↑" : sortDir === "desc" ? "Priority ↓" : "Manual"}
          </button>
        </div>
      </div>

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
              <option key={p} value={p}>{p} — {PRIORITY_COLORS[p].label}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <input value={newNotes} onChange={(e) => setNewNotes(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="Short note (optional)..."
            className="flex-1 bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-txt placeholder-txt3" />
          <button onClick={addTask} disabled={!newName.trim()}
            className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white disabled:opacity-50 transition-colors">
            Add
          </button>
        </div>
      </div>

      {/* Tasks */}
      <div className="space-y-2">
        {sortedTasks.map((task, idx) => {
          const pc = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[3];
          const borderColor = PRIORITY_BORDER_STYLES[task.priority] || "#eab308";

          return (
            <div key={task.id}
              draggable={sortDir === "manual"}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={cn(
                "bg-surface border-l-[3px] border border-border rounded-lg px-4 py-3 group transition-all",
                dragIdx === idx && "opacity-50 scale-[0.98]"
              )}
              style={{ borderLeftColor: borderColor }}>
              <div className="flex items-center gap-3">
                {sortDir === "manual" && (
                  <span className="cursor-grab text-txt3 opacity-0 group-hover:opacity-100 transition-opacity select-none shrink-0">⠿</span>
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
                    <p className="text-sm font-medium text-bright truncate cursor-pointer"
                      onClick={() => setEditingId(task.id)}>{task.name}</p>
                  )}
                  {task.notes && <p className="text-xs text-txt3 mt-0.5 truncate">{task.notes}</p>}
                </div>

                <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded shrink-0", pc.bg, pc.text)}>
                  P{task.priority}
                </span>

                <select value={task.priority}
                  onChange={(e) => updateTask(task.id, "priority", parseInt(e.target.value))}
                  className="bg-transparent border-none text-[10px] text-txt3 opacity-0 group-hover:opacity-100 transition-opacity w-8">
                  {[1,2,3,4,5].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>

                <GCalButton title={task.name} date={null} description={task.notes} />

                <button onClick={() => setConfirmId(task.id)}
                  className="text-xs px-2 py-1 rounded border border-border text-txt3 opacity-0 group-hover:opacity-100 hover:border-green-acc hover:text-green-acc transition-all shrink-0">
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
