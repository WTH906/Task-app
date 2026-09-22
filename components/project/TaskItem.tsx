"use client";

import { useState } from "react";
import { ProjectTask, Subtask } from "@/lib/types";
import { formatSeconds, formatMinutes, progressColor, cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import { InlineEdit } from "@/components/InlineEdit";
import { CalendarPicker } from "@/components/CalendarPicker";
import { FileAttachment } from "@/components/FileAttachment";
import { GCalButton } from "@/components/GCalButton";
import { createClient } from "@/lib/supabase";
import { useSettings } from "@/lib/hooks/useSettings";
import {
  isRecurrence, currentPeriodKey, computeStreak,
  RECURRENCE_LABEL, PERIOD_NOUN,
} from "@/lib/recurrence";
import { RefreshCw, Flame } from "lucide-react";

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
  archiveTask: (id: string) => void;
  archiveSubtask: (subId: string, parentId: string) => void;
  monitorTask: (taskId: string, taskName: string, isSubtask?: boolean, subtaskId?: string) => void;
  duplicateSubtask: (sub: Subtask, parentTaskId: string) => void;
  /** Open the hour picker for this task's planner occurrence. */
  scheduleTask: (task: ProjectTask) => void;
  /**
   * Repeating tasks only — records completion for one period.
   *
   * The period key is passed in rather than recomputed by the handler. The
   * row derives it once at render; if the clock crosses midnight while the
   * page sits open, recomputing on click would toggle a DIFFERENT period from
   * the one the checkbox is showing — so unticking yesterday would tick today.
   */
  toggleTaskCheck: (id: string, periodKey: string) => void;
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
  /** Period keys this repeating task has been completed in. Undefined = not repeating. */
  checkedPeriods?: Set<string>;
  actions: TaskActions;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

export function TaskItem({
  task, project, idx, activeTaskId, elapsed,
  isExpanded, menuOpen, setMenuOpen, subMenuOpen, setSubMenuOpen,
  dragSubIdx, dragSubParent, userId, checkedPeriods, actions,
  onDragStart, onDragOver, onDragEnd,
}: TaskItemProps) {
  const { has } = useSettings();
  // Timers can be switched off — but hiding the button while a timer is
  // running would strand it: `timer_started_at` stays set with no way to
  // clear it. Always show the control for a timer that's actually running.
  const showTimers = has("timers");
  const isActive = activeTaskId === task.id;
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // ── Repeating tasks ──────────────────────────────────────────────────
  //
  // A repeating task's completion is per period, not a single `progress`
  // value that stays at 100 forever. The checkbox therefore answers "have I
  // done it THIS period", and it empties itself when the period rolls over.
  //
  // None of this was visible before: recurrence appeared nowhere on the row
  // and only inside the edit modal behind a disclosure, so "it didn't save"
  // and "it saved and I can't see it" looked identical.
  const recurrence = isRecurrence(task.recurrence) ? task.recurrence : null;
  const period = recurrence ? currentPeriodKey(recurrence) : null;
  const doneThisPeriod = !!(period && checkedPeriods?.has(period));
  const streak = recurrence ? computeStreak(recurrence, checkedPeriods ?? new Set()) : 0;

  // For a repeating task "done" means done for now, so the row dims for the
  // rest of the period and comes back on its own.
  const isDone = recurrence ? doneThisPeriod : task.progress >= 100;

  // Date and deadline pickers are hidden on a finished one-off task, but a
  // repeating task is never "finished" — it always needs its start date and
  // deadline reachable.
  const showSchedule = recurrence ? true : task.progress < 100;

  const openMenuAt = (e: React.MouseEvent, id: string, setter: (v: string | null) => void, otherSetter: (v: string | null) => void) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const menuH = 200; // approximate max menu height
    const top = rect.bottom + menuH > window.innerHeight ? rect.top - menuH : rect.bottom + 4;
    setMenuPos({ top: Math.max(8, top), left: Math.min(rect.right - 160, window.innerWidth - 170) });
    setter(setter === setMenuOpen ? (menuOpen === id ? null : id) : (subMenuOpen === id ? null : id));
    otherSetter(null);
  };

  return (
    <div draggable onDragStart={(e) => {
      e.dataTransfer.setData("task-id", task.id);
      e.dataTransfer.setData("task-name", task.name);
      e.dataTransfer.effectAllowed = "move";
      onDragStart();
    }} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className={cn(
        "bg-surface border-2 rounded-lg transition-colors card-float overflow-visible",
        isDone && "opacity-60"
      )} style={{
        borderColor: isActive ? "#4caf50" : task.monitoring ? "#f59e0b" : "var(--border)",
        boxShadow: isActive ? "0 4px 12px rgba(76,175,80,0.1)" : task.monitoring ? "0 2px 8px rgba(245,158,11,0.15)" : undefined,
      }}>
        {/* Row 1: drag + play + name */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="cursor-grab text-txt3 hover:text-txt select-none">⠿</span>
          <input
            type="checkbox"
            checked={isDone}
            onChange={() => recurrence && period
              ? actions.toggleTaskCheck(task.id, period)
              : actions.updateTaskField(task.id, "progress", isDone ? 0 : 100)}
            className="shrink-0"
            aria-label={recurrence
              ? `${isDone ? "Not done" : "Done"} ${PERIOD_NOUN[recurrence]}: ${task.name}`
              : `${isDone ? "Mark incomplete" : "Mark complete"}: ${task.name}`}
            title={recurrence
              ? isDone
                ? `Done ${PERIOD_NOUN[recurrence]} — click to undo`
                : `Mark done for ${PERIOD_NOUN[recurrence]}`
              : isDone ? "Mark as incomplete" : "Mark as complete"}
          />
          {(showTimers || isActive) && (
            <button
              onClick={() => actions.toggleTimer(task.id)}
              aria-label={isActive ? `Pause timer for ${task.name}` : `Start timer for ${task.name}`}
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 transition-colors",
                isActive ? "bg-green-acc/20 text-green-acc" : "bg-surface2 text-txt3 hover:text-red-acc hover:bg-red-acc/10"
              )}
            >
              {isActive ? "⏸" : "▶"}
            </button>
          )}
          <span className={cn("flex-1 text-sm font-medium", isDone && "task-done")}>
            {task.name}
            {recurrence && <RefreshCw size={11} className="inline ml-1.5 text-violet2 opacity-70" />}
          </span>
          {isActive && (
            <span className="font-mono text-sm text-green-acc timer-active">
              {formatSeconds(elapsed[task.id] || 0)}
            </span>
          )}
        </div>

        {/* Row 2: meta */}
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 text-xs">
          <span className="bg-surface2 text-txt3 px-2 py-0.5 rounded font-mono">{formatMinutes(task.est_minutes)}</span>

          {/*
            The repeat badge. Its only job is to make the setting verifiable
            at a glance — the reason the previous version felt like it wasn't
            saving is that there was nothing anywhere on the row to confirm it
            had. Clicking it opens the editor on the same field.
          */}
          {recurrence && (
            <button
              onClick={() => actions.openEditModal(task, "task")}
              title={`Repeats ${RECURRENCE_LABEL[recurrence].toLowerCase()} — click to change`}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors",
                doneThisPeriod
                  ? "bg-green-acc/15 text-green-acc"
                  : "bg-violet/15 text-violet2 hover:bg-violet/25"
              )}
            >
              <RefreshCw size={11} className="shrink-0" />
              <span>{RECURRENCE_LABEL[recurrence]}</span>
              <span className="opacity-70">· {doneThisPeriod ? `done ${PERIOD_NOUN[recurrence]}` : PERIOD_NOUN[recurrence]}</span>
            </button>
          )}

          {/* Consecutive periods completed. Hidden below 2 — "1" isn't a run. */}
          {recurrence && streak > 1 && (
            <span className="flex items-center gap-0.5 text-amber font-mono"
              title={`${streak} ${RECURRENCE_LABEL[recurrence].toLowerCase().replace(/ly$/, "")} periods in a row`}>
              <Flame size={11} className="shrink-0" /> {streak}
            </span>
          )}

          {/*
            A repeating task always keeps its date controls. `progress` no
            longer describes it — a stale 100 left over from an import or a
            subtask roll-up would otherwise hide the very control that sets
            where the series starts, with no way to get it back.
          */}
          {showSchedule && (
            <CalendarPicker value={task.date_key} onChange={(d) => actions.updateTaskField(task.id, "date_key", d)} variant="date" />
          )}
          {task.date_key && !showSchedule && (
            <span className="text-[10px] text-green-acc font-mono">✓ scheduled</span>
          )}

          {showSchedule && (
            <>
              <CalendarPicker value={task.deadline} onChange={(d) => actions.updateTaskField(task.id, "deadline", d)} variant="deadline" />
              {has("gcal") && <GCalButton title={`[${project.title}] ${task.name}`} date={task.date_key || null} />}
            </>
          )}
          {task.deadline && !showSchedule && (
            <span className="text-[10px] text-green-acc font-mono">✓ deadline</span>
          )}

          <div className="w-px h-3 bg-border" />
          {/*
            Percent-complete is meaningless on a repeating task: it is either
            done for this period or it isn't, and a stored 100 would make it
            read as permanently finished (and count as finished in the stats)
            forever. The badge above carries that state instead.
          */}
          {!recurrence && (
            <>
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: progressColor(task.progress) }} />
              <div className="flex items-center gap-1">
                <InlineEdit value={String(task.progress)} onSave={(v) => actions.updateTaskField(task.id, "progress", parseInt(v) || 0)} type="number" min={0} max={100} className="w-10 text-xs" />
                <span className="text-txt3">%</span>
              </div>
              {task.progress > 0 && task.progress < 100 && <ProgressBar value={task.progress} height={4} />}
            </>
          )}
          {showTimers && (
            <span className="font-mono text-[10px] text-txt3" title="Time tracked">
              {formatSeconds(elapsed[task.id] ?? task.elapsed_seconds)}
            </span>
          )}
          <InlineEdit value={task.notes} onSave={(v) => actions.updateTaskField(task.id, "notes", v)} placeholder="Notes..." className="text-xs text-txt3 flex-1 min-w-[80px]" />
          {has("attachments") && <FileAttachment
            fileUrl={task.file_url} fileName={task.file_name} userId={userId} entityId={task.id}
            onUploaded={async (url, name) => { const s = createClient(); await s.from("project_tasks").update({ file_url: url, file_name: name }).eq("id", task.id); actions.updateTaskLocal(task.id, { file_url: url, file_name: name }); }}
            onRemoved={async () => { const s = createClient(); await s.from("project_tasks").update({ file_url: null, file_name: null }).eq("id", task.id); actions.updateTaskLocal(task.id, { file_url: null, file_name: null }); }}
          />}

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
            <button onClick={(e) => openMenuAt(e, task.id, setMenuOpen, setSubMenuOpen)}
              aria-label={`Actions for ${task.name}`}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface2 text-txt3">⋯</button>
            {menuOpen === task.id && menuPos && (
              <div data-ctx-menu className="fixed glass-popover py-1 w-40 z-[100]"
                style={{ top: menuPos.top, left: menuPos.left }}>
                <button onClick={() => { actions.openEditModal(task, "task"); setMenuOpen(null); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-glass-text hover:bg-white/5">Edit</button>
                {(task.subtasks?.length || 0) < 10 && (
                  <button onClick={() => { actions.openEditModal(null, "subtask", task.id); setMenuOpen(null); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-glass-text hover:bg-white/5">Add subtask</button>
                )}
                {/*
                  Only offered once the task has a day. A time is a refinement
                  of "which day", so without a date there is no occurrence on
                  the calendar to put it on — the item would open a picker
                  that had nowhere to save to.
                */}
                {has("scheduler") && task.date_key && (
                  <button onClick={() => { actions.scheduleTask(task); setMenuOpen(null); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-glass-text hover:bg-white/5">Schedule…</button>
                )}
                {has("monitoring") && (
                  <button onClick={() => { actions.monitorTask(task.id, task.name); setMenuOpen(null); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-amber hover:bg-white/5">
                    {task.monitoring ? "Unmonitor" : "Monitor"}
                  </button>
                )}
                <button onClick={() => { actions.archiveTask(task.id); setMenuOpen(null); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-txt3 hover:bg-white/5">Archive</button>
                <button onClick={() => actions.removeTask(task.id)}
                  className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-white/5">Remove</button>
              </div>
            )}
          </div>
        </div>

        {/* Subtasks */}
        {isExpanded && task.subtasks && task.subtasks.length > 0 && (
          <div className="border-t border-border bg-surface2/50 overflow-visible">
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
                style={sub.monitoring ? { borderLeft: "3px solid #f59e0b", paddingLeft: "9px" } : undefined}
              >
                <span className="cursor-grab text-txt3 opacity-30 hover:opacity-100 select-none text-[10px]">⠿</span>
                <input
                  type="checkbox"
                  checked={sub.progress >= 100}
                  onChange={() => actions.updateSubtaskField(sub.id, task.id, "progress", sub.progress >= 100 ? 0 : 100)}
                  className="shrink-0"
                  aria-label={`${sub.progress >= 100 ? "Mark incomplete" : "Mark complete"}: ${sub.name}`}
                  title={sub.progress >= 100 ? "Mark as incomplete" : "Mark as complete"}
                />
                {(showTimers || activeTaskId === `sub:${sub.id}`) && (
                  <button onClick={() => actions.toggleTimer(`sub:${sub.id}`)}
                    aria-label={activeTaskId === `sub:${sub.id}` ? `Pause timer for ${sub.name}` : `Start timer for ${sub.name}`}
                    className={cn("w-6 h-6 rounded flex items-center justify-center text-[10px] shrink-0 transition-colors",
                      activeTaskId === `sub:${sub.id}` ? "bg-green-acc/20 text-green-acc" : "bg-surface3 text-txt3 hover:text-red-acc"
                    )}>
                    {activeTaskId === `sub:${sub.id}` ? "⏸" : "▶"}
                  </button>
                )}
                {activeTaskId === `sub:${sub.id}` && (
                  <span className="font-mono text-[10px] text-green-acc timer-active">{formatSeconds(elapsed[`sub:${sub.id}`] || 0)}</span>
                )}
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: progressColor(sub.progress) }} />
                <InlineEdit value={sub.name} onSave={(v) => actions.updateSubtaskField(sub.id, task.id, "name", v)} className={cn("font-medium text-xs min-w-[100px]", sub.progress >= 100 && "line-through opacity-50")} />
                {isRecurrence(sub.recurrence) && (
                  <span className="shrink-0 text-violet2 opacity-70" title={`Repeats ${RECURRENCE_LABEL[sub.recurrence].toLowerCase()}`}>
                    <RefreshCw size={10} />
                  </span>
                )}
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
                {/*
                  Notes used to be a single truncated line clamped to 200px,
                  which cut off after roughly three words. It now wraps to up
                  to three lines (~6-9 words visible) and expands the row.
                */}
                <div className="flex-1 basis-[180px] min-w-[140px] max-w-[320px]">
                  <InlineEdit
                    value={sub.notes}
                    onSave={(v) => actions.updateSubtaskField(sub.id, task.id, "notes", v)}
                    placeholder="Notes..."
                    className="text-xs text-txt3 note-clamp"
                    title={sub.notes || undefined}
                  />
                </div>
                {has("attachments") && <FileAttachment
                  fileUrl={sub.file_url} fileName={sub.file_name} userId={userId} entityId={sub.id}
                  onUploaded={async (url, name) => { const s = createClient(); await s.from("subtasks").update({ file_url: url, file_name: name }).eq("id", sub.id); actions.updateSubtaskLocal(task.id, sub.id, { file_url: url, file_name: name }); }}
                  onRemoved={async () => { const s = createClient(); await s.from("subtasks").update({ file_url: null, file_name: null }).eq("id", sub.id); actions.updateSubtaskLocal(task.id, sub.id, { file_url: null, file_name: null }); }}
                />}
                <div className="relative">
                  <button onClick={(e) => openMenuAt(e, sub.id, setSubMenuOpen, setMenuOpen)}
                    aria-label={`Actions for ${sub.name}`}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface3 text-txt3 text-[10px]">⋯</button>
                  {subMenuOpen === sub.id && menuPos && (
                    <div data-ctx-menu className="fixed glass-popover py-1 w-40 z-[100]"
                      style={{ top: menuPos.top, left: menuPos.left }}>
                      <button onClick={() => { actions.openEditModal(sub, "subtask", task.id); setSubMenuOpen(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-glass-text hover:bg-white/5">Edit</button>
                      <button onClick={() => { actions.duplicateSubtask(sub, task.id); setSubMenuOpen(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-glass-text hover:bg-white/5">Duplicate</button>
                      <button onClick={() => { actions.setMoveSubModal({ subId: sub.id, subName: sub.name, fromTaskId: task.id }); setSubMenuOpen(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-glass-text hover:bg-white/5">Move to task...</button>
                      {has("monitoring") && (
                        <button onClick={() => { actions.monitorTask(task.id, sub.name, true, sub.id); setSubMenuOpen(null); }}
                          className="w-full text-left px-3 py-1.5 text-xs text-amber hover:bg-white/5">
                          {sub.monitoring ? "Unmonitor" : "Monitor"}
                        </button>
                      )}
                      <button onClick={() => { actions.archiveSubtask(sub.id, task.id); setSubMenuOpen(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-glass-text hover:bg-white/5">Archive</button>
                      <button onClick={() => { actions.removeSubtask(sub.id, task.id); setSubMenuOpen(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-white/5">Remove</button>
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
