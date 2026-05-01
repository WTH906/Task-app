"use client";

import { ProjectTask, Subtask } from "@/lib/types";
import { formatSeconds, formatMinutes, progressColor, cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import { InlineEdit } from "@/components/InlineEdit";
import { CalendarPicker } from "@/components/CalendarPicker";
import { FileAttachment } from "@/components/FileAttachment";
import { GCalButton } from "@/components/GCalButton";
import { createClient } from "@/lib/supabase";

export interface TaskActions {
  toggleTimer: (id: string) => void;
  removeTask: (id: string) => void;
  removeSubtask: (id: string, parentId: string) => void;
  updateTaskField: (id: string, field: string, value: string | number | null) => void;
  updateSubtaskField: (id: string, parentId: string, field: string, value: string | number | null) => void;
  updateTaskLocal: (id: string, updates: Partial<ProjectTask>) => void;
  updateSubtaskLocal: (taskId: string, subId: string, updates: Partial<Subtask>) => void;
  openEditModal: (target: ProjectTask | Subtask | null, mode: "task" | "subtask", parentTaskId?: string) => void;
  setExpandedTasks: React.Dispatch<React.SetStateAction<Set<string>>>;
  setMoveSubModal: (v: { subId: string; subName: string; fromTaskId: string } | null) => void;
  handleSubDragStart: (parentId: string, idx: number) => void;
  handleSubDragOver: (e: React.DragEvent, parentId: string, idx: number) => void;
  handleSubDragEnd: (parentId: string) => void;
}

interface TaskItemProps {
  task: ProjectTask;
  project: { id: string; title: string };
  idx: number;
  activeTaskId: string | null;
  elapsed: Record<string, number>;
  isExpanded: boolean;
  menuOpen: string | null;
  setMenuOpen: (v: string | null) => void;
  subMenuOpen: string | null;
  setSubMenuOpen: (v: string | null) => void;
  dragSubIdx: number | null;
  dragSubParent: string | null;
  userId: string;
  actions: TaskActions;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

export function TaskItem({
  task, project, idx, activeTaskId, elapsed,
  isExpanded, menuOpen, setMenuOpen, subMenuOpen, setSubMenuOpen,
  dragSubIdx, dragSubParent, userId, actions,
  onDragStart, onDragOver, onDragEnd,
}: TaskItemProps) {
  const isActive = activeTaskId === task.id;
  const isDone = task.progress >= 100;

  return (
    <div draggable onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className={cn(
        "bg-surface border rounded-lg transition-all card-float",
        isActive ? "border-green-acc shadow-lg shadow-green-acc/10" : "border-border",
        isDone && "opacity-60"
      )}>
        {/* Row 1: drag + play + name */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="cursor-grab text-txt3 hover:text-txt select-none">⠿</span>
          <button
            onClick={() => actions.toggleTimer(task.id)}
            className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 transition-colors",
              isActive ? "bg-green-acc/20 text-green-acc" : "bg-surface2 text-txt3 hover:text-red-acc hover:bg-red-acc/10"
            )}
          >
            {isActive ? "⏸" : "▶"}
          </button>
          <span className={cn("flex-1 text-sm font-medium", isDone && "task-done")}>{task.name}</span>
          {isActive && (
            <span className="font-mono text-sm text-green-acc timer-active">
              {formatSeconds(elapsed[task.id] || 0)}
            </span>
          )}
        </div>

        {/* Row 2: meta */}
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 text-xs">
          <span className="bg-surface2 text-txt3 px-2 py-0.5 rounded font-mono">{formatMinutes(task.est_minutes)}</span>

          {task.progress < 100 && (
            <CalendarPicker value={task.date_key} onChange={(d) => actions.updateTaskField(task.id, "date_key", d)} variant="date" />
          )}
          {task.date_key && task.progress >= 100 && (
            <span className="text-[10px] text-green-acc font-mono">✓ scheduled</span>
          )}

          {task.progress < 100 && (
            <>
              <CalendarPicker value={task.deadline} onChange={(d) => actions.updateTaskField(task.id, "deadline", d)} variant="deadline" />
              <GCalButton title={`[${project.title}] ${task.name}`} date={task.date_key || null} />
            </>
          )}
          {task.deadline && task.progress >= 100 && (
            <span className="text-[10px] text-green-acc font-mono">✓ deadline</span>
          )}

          <div className="w-px h-3 bg-border" />
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: progressColor(task.progress) }} />
          <div className="flex items-center gap-1">
            <InlineEdit value={String(task.progress)} onSave={(v) => actions.updateTaskField(task.id, "progress", parseInt(v) || 0)} type="number" min={0} max={100} className="w-10 text-xs" />
            <span className="text-txt3">%</span>
          </div>
          {task.progress > 0 && task.progress < 100 && <ProgressBar value={task.progress} height={4} />}
          <span className="font-mono text-[10px] text-txt3">{formatSeconds(elapsed[task.id] ?? task.elapsed_seconds)}</span>
          <InlineEdit value={task.notes} onSave={(v) => actions.updateTaskField(task.id, "notes", v)} placeholder="Notes..." className="text-xs text-txt3 flex-1 min-w-[80px]" />
          <FileAttachment
            fileUrl={task.file_url} fileName={task.file_name} userId={userId} entityId={task.id}
            onUploaded={async (url, name) => { const s = createClient(); await s.from("project_tasks").update({ file_url: url, file_name: name }).eq("id", task.id); actions.updateTaskLocal(task.id, { file_url: url, file_name: name }); }}
            onRemoved={async () => { const s = createClient(); await s.from("project_tasks").update({ file_url: null, file_name: null }).eq("id", task.id); actions.updateTaskLocal(task.id, { file_url: null, file_name: null }); }}
          />

          {(task.subtasks?.length || 0) > 0 && (
            <button onClick={() => {
              const s = new Set<string>();
              // Copy existing and toggle
              actions.setExpandedTasks((prev) => { const n = new Set(prev); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n; });
            }} className="text-txt3 hover:text-txt transition-colors">
              {isExpanded ? "▾" : "▸"} {task.subtasks?.length}
            </button>
          )}

          {/* Menu */}
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === task.id ? null : task.id); setSubMenuOpen(null); }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface2 text-txt3">⋯</button>
            {menuOpen === task.id && (
              <div className="absolute right-0 top-full mt-1 bg-surface2 border border-border rounded-lg shadow-xl py-1 w-36 z-20">
                <button onClick={() => { actions.openEditModal(task, "task"); setMenuOpen(null); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-txt2 hover:bg-surface3">Edit</button>
                {(task.subtasks?.length || 0) < 10 && (
                  <button onClick={() => { actions.openEditModal(null, "subtask", task.id); setMenuOpen(null); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-txt2 hover:bg-surface3">Add subtask</button>
                )}
                <button onClick={() => actions.removeTask(task.id)}
                  className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-surface3">Remove</button>
              </div>
            )}
          </div>
        </div>

        {/* Subtasks */}
        {isExpanded && task.subtasks && task.subtasks.length > 0 && (
          <div className="border-t border-border bg-surface2/50">
            {task.subtasks.map((sub, subIdx) => (
              <div
                key={sub.id} draggable
                onDragStart={() => actions.handleSubDragStart(task.id, subIdx)}
                onDragOver={(e) => actions.handleSubDragOver(e, task.id, subIdx)}
                onDragEnd={() => actions.handleSubDragEnd(task.id)}
                className={cn(
                  "flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/50 last:border-b-0 text-xs",
                  activeTaskId === `sub:${sub.id}` && "bg-green-acc/5",
                  dragSubIdx === subIdx && dragSubParent === task.id && "opacity-50"
                )}
              >
                <span className="cursor-grab text-txt3 opacity-30 hover:opacity-100 select-none text-[10px]">⠿</span>
                <button onClick={() => actions.toggleTimer(`sub:${sub.id}`)}
                  className={cn("w-6 h-6 rounded flex items-center justify-center text-[10px] shrink-0 transition-colors",
                    activeTaskId === `sub:${sub.id}` ? "bg-green-acc/20 text-green-acc" : "bg-surface3 text-txt3 hover:text-red-acc"
                  )}>
                  {activeTaskId === `sub:${sub.id}` ? "⏸" : "▶"}
                </button>
                {activeTaskId === `sub:${sub.id}` && (
                  <span className="font-mono text-[10px] text-green-acc timer-active">{formatSeconds(elapsed[`sub:${sub.id}`] || 0)}</span>
                )}
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: progressColor(sub.progress) }} />
                <InlineEdit value={sub.name} onSave={(v) => actions.updateSubtaskField(sub.id, task.id, "name", v)} className="font-medium text-xs min-w-[100px]" />
                <InlineEdit value={String(sub.est_minutes)} onSave={(v) => actions.updateSubtaskField(sub.id, task.id, "est_minutes", parseInt(v) || 0)} type="number" min={0} className="w-10 text-xs text-txt3" placeholder="0" />
                <span className="text-txt3 text-[10px]">min</span>
                <div className="flex items-center gap-1">
                  <InlineEdit value={String(sub.progress)} onSave={(v) => actions.updateSubtaskField(sub.id, task.id, "progress", parseInt(v) || 0)} type="number" min={0} max={100} className="w-10 text-xs" />
                  <span className="text-txt3">%</span>
                </div>
                {sub.progress < 100 ? (
                  <>
                    <CalendarPicker value={sub.date_key} onChange={(d) => actions.updateSubtaskField(sub.id, task.id, "date_key", d)} variant="date" />
                    <CalendarPicker value={sub.deadline} onChange={(d) => actions.updateSubtaskField(sub.id, task.id, "deadline", d)} variant="deadline" />
                  </>
                ) : (sub.deadline || sub.date_key) ? (
                  <span className="text-[10px] text-green-acc font-mono">✓</span>
                ) : null}
                <div className="flex-1 min-w-[80px]">
                  <InlineEdit value={sub.notes} onSave={(v) => actions.updateSubtaskField(sub.id, task.id, "notes", v)} placeholder="Notes..." className="text-xs text-txt3" />
                </div>
                <FileAttachment
                  fileUrl={sub.file_url} fileName={sub.file_name} userId={userId} entityId={sub.id}
                  onUploaded={async (url, name) => { const s = createClient(); await s.from("subtasks").update({ file_url: url, file_name: name }).eq("id", sub.id); actions.updateSubtaskLocal(task.id, sub.id, { file_url: url, file_name: name }); }}
                  onRemoved={async () => { const s = createClient(); await s.from("subtasks").update({ file_url: null, file_name: null }).eq("id", sub.id); actions.updateSubtaskLocal(task.id, sub.id, { file_url: null, file_name: null }); }}
                />
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); setSubMenuOpen(subMenuOpen === sub.id ? null : sub.id); setMenuOpen(null); }}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface3 text-txt3 text-[10px]">⋯</button>
                  {subMenuOpen === sub.id && (
                    <div className="absolute right-0 top-full mt-1 bg-surface2 border border-border rounded-lg shadow-xl py-1 w-40 z-20">
                      <button onClick={() => { actions.openEditModal(sub, "subtask", task.id); setSubMenuOpen(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-txt2 hover:bg-surface3">Edit</button>
                      <button onClick={() => { actions.setMoveSubModal({ subId: sub.id, subName: sub.name, fromTaskId: task.id }); setSubMenuOpen(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-txt2 hover:bg-surface3">Move to task...</button>
                      <button onClick={() => { actions.removeSubtask(sub.id, task.id); setSubMenuOpen(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface3">Remove</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
