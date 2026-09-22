"use client";

import { useState } from "react";
import { ProjectTask } from "@/lib/types";
import { Calendar } from "lucide-react";

export function googleCalendarUrl(params: {
  title: string;
  date: string;
  description?: string;
}): string {
  const { title, date, description } = params;
  const dateClean = date.replace(/-/g, "");
  // Add one day for end date using local time (avoids timezone shift)
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + 1);
  const end = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", title);
  url.searchParams.set("dates", `${dateClean}/${end}`);
  if (description) url.searchParams.set("details", description);
  return url.toString();
}

export function GCalButton({
  title, date, description, className = "",
}: {
  title: string; date: string | null; description?: string; className?: string;
}) {
  if (!date) return null;
  const url = googleCalendarUrl({ title, date, description });
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className={`flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface3 hover:bg-border text-txt3 hover:text-txt transition-colors ${className}`}
      title="Add to Google Calendar" onClick={(e) => e.stopPropagation()}>
      <Calendar size={12} /><span>GCal</span>
    </a>
  );
}

export function GCalSyncModal({
  open, onClose, projectTitle, tasks,
}: {
  open: boolean; onClose: () => void; projectTitle: string; tasks: ProjectTask[];
}) {
  const [synced, setSynced] = useState<Set<string>>(new Set());
  if (!open) return null;

  type SyncItem = {
    id: string; name: string; date_key: string | null; deadline: string | null;
    notes: string; progress: number; isSubtask: boolean; parentName?: string; parentNotes?: string;
  };

  const items: SyncItem[] = [];
  for (const task of tasks) {
    items.push({
      id: task.id, name: task.name, date_key: task.date_key, deadline: task.deadline,
      notes: task.notes, progress: task.progress, isSubtask: false,
    });
    for (const sub of task.subtasks || []) {
      items.push({
        id: sub.id, name: sub.name, date_key: sub.date_key, deadline: sub.deadline,
        notes: sub.notes, progress: sub.progress, isSubtask: true,
        parentName: task.name, parentNotes: task.notes,
      });
    }
  }

  const handleSync = (item: SyncItem, useDate: "date" | "deadline") => {
    const syncDate = useDate === "date" ? item.date_key : item.deadline;
    if (!syncDate) return;

    const descParts: string[] = [];
    descParts.push(`Project: ${projectTitle}`);
    if (item.isSubtask && item.parentName) {
      descParts.push(`Task: ${item.parentName}`);
      if (item.parentNotes) descParts.push(`Task notes: ${item.parentNotes}`);
    }
    if (item.notes) descParts.push(`Notes: ${item.notes}`);
    descParts.push(`Progress: ${item.progress}%`);
    if (useDate === "date") descParts.push("Type: Scheduled task");
    else descParts.push("Type: Deadline");

    const url = googleCalendarUrl({
      title: item.isSubtask
        ? `[${projectTitle}] ${item.parentName} → ${item.name}`
        : `[${projectTitle}] ${item.name}`,
      date: syncDate,
      description: descParts.join("\n"),
    });

    window.open(url, "_blank");
    setSynced(prev => new Set(prev).add(`${item.id}-${useDate}`));
  };

  const withDates = items.filter(i => i.date_key);
  const withDeadlines = items.filter(i => i.deadline);
  const withNeither = items.filter(i => !i.date_key && !i.deadline);

  const SyncRow = ({ item, type }: { item: SyncItem; type: "date" | "deadline" }) => {
    const key = `${item.id}-${type}`;
    const isSynced = synced.has(key);
    const dateVal = type === "date" ? item.date_key : item.deadline;
    return (
      <button onClick={() => handleSync(item, type)}
        className={`w-full text-left rounded-lg border px-3 py-2 transition-all ${
          isSynced ? "bg-green-acc/10 border-green-acc/30" : "border-border/50 hover:border-violet/40"
        }`}
        style={!isSynced ? { background: "color-mix(in srgb, var(--glass-bg) 40%, transparent)" } : undefined}>
        <div className="flex items-center gap-2">
          {item.isSubtask
            ? <span className="text-[10px] text-violet2 bg-violet/10 px-1.5 py-0.5 rounded shrink-0">SUB</span>
            : <span className="text-[10px] text-txt2 bg-surface3 px-1.5 py-0.5 rounded shrink-0">TASK</span>}
          <span className="text-sm text-bright flex-1 truncate">{item.name}</span>
          {isSynced
            ? <span className="text-[10px] text-green-acc">✓</span>
            : <span className="text-[10px] text-violet2"><Calendar size={10} /></span>}
        </div>
        <div className="text-[10px] text-txt3 mt-0.5 font-mono">{dateVal}</div>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-w-3xl w-full max-h-[85vh] overflow-hidden rounded-2xl flex flex-col"
        style={{
          background: "color-mix(in srgb, var(--surface) 85%, transparent)",
          backdropFilter: "blur(24px) saturate(150%)",
          WebkitBackdropFilter: "blur(24px) saturate(150%)",
          border: "1px solid color-mix(in srgb, var(--glass-accent) 20%, transparent)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.4), inset 0 1px 0 color-mix(in srgb, var(--glass-accent) 10%, transparent)",
        }}>
        <div className="flex items-center justify-between p-4 border-b shrink-0" style={{ borderColor: "color-mix(in srgb, var(--glass-accent) 15%, transparent)" }}>
          <div>
            <h2 className="font-title text-bright text-lg flex items-center gap-2"><Calendar size={18} /> Sync to Google Calendar</h2>
            <p className="text-xs text-txt3 mt-0.5">Click any item to create a calendar event</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface3 text-txt3 hover:text-txt">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Column 1: Tasks with dates */}
            <div>
              <h3 className="text-xs text-txt3 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Calendar size={12} /> Scheduled dates
                <span className="text-[10px] font-mono bg-surface3 px-1.5 py-0.5 rounded">{withDates.length}</span>
              </h3>
              <div className="space-y-1.5">
                {withDates.length === 0 ? (
                  <p className="text-xs text-txt3 py-4 text-center opacity-50">No tasks with dates</p>
                ) : withDates.map(item => (
                  <SyncRow key={`d-${item.id}`} item={item} type="date" />
                ))}
              </div>
            </div>

            {/* Column 2: Tasks with deadlines */}
            <div>
              <h3 className="text-xs text-txt3 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <span className="text-danger">⏰</span> Deadlines
                <span className="text-[10px] font-mono bg-surface3 px-1.5 py-0.5 rounded">{withDeadlines.length}</span>
              </h3>
              <div className="space-y-1.5">
                {withDeadlines.length === 0 ? (
                  <p className="text-xs text-txt3 py-4 text-center opacity-50">No tasks with deadlines</p>
                ) : withDeadlines.map(item => (
                  <SyncRow key={`dl-${item.id}`} item={item} type="deadline" />
                ))}
              </div>
            </div>
          </div>

          {/* Items with neither */}
          {withNeither.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-[10px] text-txt3 uppercase tracking-wider mb-2">No date or deadline</p>
              <div className="flex flex-wrap gap-1.5">
                {withNeither.map(item => (
                  <span key={item.id} className="text-[10px] text-txt3 bg-surface3 px-2 py-1 rounded opacity-50">
                    {item.isSubtask ? "↳ " : ""}{item.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-3 border-t shrink-0 flex items-center justify-between" style={{ borderColor: "color-mix(in srgb, var(--glass-accent) 15%, transparent)" }}>
          <span className="text-xs text-txt3">{synced.size > 0 && `${synced.size} synced`}</span>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-surface3 text-txt2 hover:text-txt hover:bg-border transition-colors">Done</button>
        </div>
      </div>
    </div>
  );
}
