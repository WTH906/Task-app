"use client";

import { useState, useRef } from "react";
import { ProjectTask } from "@/lib/types";
import { ProgressBar } from "@/components/ProgressBar";
import { formatMinutes, cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";

type Column = "todo" | "in_progress" | "done";

const COLUMNS: { key: Column; label: string; accent: string }[] = [
  { key: "todo", label: "To Do", accent: "var(--txt3)" },
  { key: "in_progress", label: "In Progress", accent: "var(--amber, #f59e0b)" },
  { key: "done", label: "Done", accent: "var(--green-acc, #4caf50)" },
];

function classifyTask(task: ProjectTask): Column {
  const subs = task.subtasks || [];
  if (subs.length === 0) {
    if (task.progress >= 100) return "done";
    if (task.progress > 0) return "in_progress";
    return "todo";
  }
  const allDone = subs.every((s) => s.progress >= 100);
  const anyStarted = subs.some((s) => s.progress > 0);
  if (allDone) return "done";
  if (anyStarted) return "in_progress";
  return "todo";
}

interface KanbanBoardProps {
  tasks: ProjectTask[];
  projectTitle: string;
  elapsed: Record<string, number>;
  onTaskClick: (task: ProjectTask) => void;
  onProgressChange: (taskId: string, progress: number) => void;
  onSubtaskToggle: (subtaskId: string, parentId: string, progress: number) => void;
}

export function KanbanBoard({
  tasks, projectTitle, elapsed, onTaskClick, onProgressChange, onSubtaskToggle,
}: KanbanBoardProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const dragRef = useRef<{ taskId: string; fromCol: Column } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<Column | null>(null);

  const columns: Record<Column, ProjectTask[]> = { todo: [], in_progress: [], done: [] };
  for (const t of tasks) columns[classifyTask(t)].push(t);

  const toggleCard = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDragStart = (taskId: string, fromCol: Column) => {
    dragRef.current = { taskId, fromCol };
  };

  const handleDragOver = (e: React.DragEvent, col: Column) => {
    e.preventDefault();
    setDragOverCol(col);
  };

  const handleDragLeave = () => setDragOverCol(null);

  const handleDrop = (targetCol: Column) => {
    setDragOverCol(null);
    if (!dragRef.current) return;
    const { taskId, fromCol } = dragRef.current;
    dragRef.current = null;
    if (fromCol === targetCol) return;

    const progressMap: Record<Column, number> = { todo: 0, in_progress: 50, done: 100 };
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const subs = task.subtasks || [];
    if (subs.length > 0) {
      const targetProgress = progressMap[targetCol];
      for (const s of subs) {
        if (targetCol === "done" && s.progress < 100) {
          onSubtaskToggle(s.id, taskId, 100);
        } else if (targetCol === "todo" && s.progress > 0) {
          onSubtaskToggle(s.id, taskId, 0);
        }
      }
      if (targetCol === "in_progress" && subs.every((s) => s.progress === 0)) {
        onSubtaskToggle(subs[0].id, taskId, 50);
      }
    } else {
      onProgressChange(taskId, progressMap[targetCol]);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {COLUMNS.map(({ key, label, accent }) => (
        <div
          key={key}
          className={cn(
            "rounded-xl border bg-surface/40 min-h-[200px] flex flex-col transition-colors",
            dragOverCol === key ? "border-violet/60 bg-violet/5" : "border-border",
          )}
          onDragOver={(e) => handleDragOver(e, key)}
          onDragLeave={handleDragLeave}
          onDrop={() => handleDrop(key)}
        >
          <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: accent }}
            />
            <span className="text-xs font-medium text-txt2">{label}</span>
            <span className="text-[10px] font-mono text-txt3 ml-auto">
              {columns[key].length}
            </span>
          </div>

          <div className="flex-1 p-2 space-y-2">
            {columns[key].map((task) => {
              const subs = task.subtasks || [];
              const doneSubs = subs.filter((s) => s.progress >= 100).length;
              const isExpanded = expandedCards.has(task.id);

              return (
                <div
                  key={task.id}
                  draggable
                  onDragStart={() => handleDragStart(task.id, key)}
                  className="rounded-lg border border-border bg-surface px-3 py-2.5 cursor-grab active:cursor-grabbing hover:border-violet/40 transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <GripVertical
                      size={12}
                      className="text-txt3 opacity-0 group-hover:opacity-60 mt-0.5 shrink-0 transition-opacity"
                    />
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => onTaskClick(task)}
                        className="text-sm text-txt font-medium text-left truncate w-full hover:text-bright transition-colors"
                      >
                        {task.name}
                      </button>

                      <div className="flex items-center gap-2 mt-1.5">
                        {task.est_minutes > 0 && (
                          <span className="text-[10px] text-txt3">
                            {formatMinutes(task.est_minutes)}
                          </span>
                        )}
                        {task.deadline && (
                          <span className="text-[10px] text-txt3">
                            Due {task.deadline}
                          </span>
                        )}
                        {task.monitoring && (
                          <span className="text-[10px] text-amber">monitored</span>
                        )}
                      </div>

                      {subs.length > 0 && (
                        <>
                          <div className="mt-2">
                            <ProgressBar
                              value={task.progress}
                              height={4}
                              showLabel={false}
                            />
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleCard(task.id); }}
                            className="flex items-center gap-1 mt-1.5 text-[10px] text-txt3 hover:text-txt transition-colors"
                          >
                            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            {doneSubs}/{subs.length} subtasks
                          </button>

                          {isExpanded && (
                            <div className="mt-1.5 space-y-1 ml-1">
                              {subs.map((sub) => (
                                <label
                                  key={sub.id}
                                  className="flex items-center gap-1.5 text-[11px] cursor-pointer group/sub"
                                >
                                  <input
                                    type="checkbox"
                                    checked={sub.progress >= 100}
                                    onChange={() =>
                                      onSubtaskToggle(
                                        sub.id,
                                        task.id,
                                        sub.progress >= 100 ? 0 : 100,
                                      )
                                    }
                                    className="accent-violet rounded"
                                  />
                                  <span
                                    className={cn(
                                      "truncate",
                                      sub.progress >= 100
                                        ? "line-through text-txt3"
                                        : "text-txt2",
                                    )}
                                  >
                                    {sub.name}
                                  </span>
                                </label>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      {subs.length === 0 && key !== "done" && key !== "todo" && (
                        <div className="mt-2">
                          <ProgressBar
                            value={task.progress}
                            height={4}
                            showLabel={false}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {columns[key].length === 0 && (
              <div className="flex items-center justify-center h-20 text-[11px] text-txt3 opacity-50">
                {key === "todo" ? "All tasks started" : key === "done" ? "Nothing completed yet" : "Drag tasks here"}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
