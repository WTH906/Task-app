"use client";

import { useState } from "react";
import { ProjectTask } from "@/lib/types";
import { progressColor } from "@/lib/utils";

export function googleCalendarUrl(params: {
  title: string;
  date: string;
  description?: string;
}): string {
  const { title, date, description } = params;
  const dateClean = date.replace(/-/g, "");
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const end = d.toISOString().split("T")[0].replace(/-/g, "");

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
      <span>📆</span><span>GCal</span>
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
    id: string; name: string; deadline: string | null; notes: string;
    progress: number; isSubtask: boolean; parentName?: string; parentNotes?: string;
  };

  const items: SyncItem[] = [];
  for (const task of tasks) {
    items.push({
      id: task.id, name: task.name, deadline: task.deadline,
      notes: task.notes, progress: task.progress, isSubtask: false,
    });
    for (const sub of task.subtasks || []) {
      items.push({
        id: sub.id, name: sub.name, deadline: sub.deadline,
        notes: sub.notes, progress: sub.progress, isSubtask: true,
        parentName: task.name, parentNotes: task.notes,
      });
    }
  }

  const handleSync = (item: SyncItem) => {
    if (!item.deadline) return;

    // Build rich description
    const descParts: string[] = [];
    descParts.push(`Project: ${projectTitle}`);
    if (item.isSubtask && item.parentName) {
      descParts.push(`Task: ${item.parentName}`);
      if (item.parentNotes) descParts.push(`Task notes: ${item.parentNotes}`);
    }
    if (item.notes) descParts.push(`Notes: ${item.notes}`);
    descParts.push(`Progress: ${item.progress}%`);

    const url = googleCalendarUrl({
      title: item.isSubtask
        ? `[${projectTitle}] ${item.parentName} → ${item.name}`
        : `[${projectTitle}] ${item.name}`,
      date: item.deadline,
      description: descParts.join("\n"),
    });

    window.open(url, "_blank");
    setSynced((prev) => new Set(prev).add(item.id));
  };

  const withDeadlines = items.filter((i) => i.deadline);
  const withoutDeadlines = items.filter((i) => !i.deadline);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface2 border border-border rounded-xl max-w-lg w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-title text-bright text-lg">📆 Sync to Google Calendar</h2>
            <p className="text-xs text-txt3 mt-0.5">Click any item to create a calendar event</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface3 text-txt3 hover:text-txt">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {withDeadlines.length === 0 && (
            <p className="text-sm text-txt3 text-center py-8">No tasks or subtasks with deadlines to sync.</p>
          )}
          {withDeadlines.map((item) => {
            const isSynced = synced.has(item.id);
            return (
              <button key={item.id} onClick={() => handleSync(item)}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all ${
                  isSynced ? "bg-green-acc/10 border-green-acc/30" : "bg-surface border-border hover:border-amber/40 hover:bg-amber/5"
                }`}>
                <div className="flex items-center gap-2">
                  {item.isSubtask
                    ? <span className="text-[10px] text-violet2 bg-violet/10 px-1.5 py-0.5 rounded shrink-0">SUB</span>
                    : <span className="text-[10px] text-red-acc bg-red-acc/10 px-1.5 py-0.5 rounded shrink-0">TASK</span>}
                  <span className="text-sm text-bright flex-1 truncate">{item.name}</span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: progressColor(item.progress) }} />
                  {isSynced
                    ? <span className="text-xs text-green-acc shrink-0">✓ Sent</span>
                    : <span className="text-xs text-amber shrink-0">📆 Add</span>}
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-txt3">
                  <span className="font-mono">{item.deadline}</span>
                  {item.isSubtask && item.parentName && (
                    <><span className="text-border2">·</span><span className="truncate">in: {item.parentName}</span></>
                  )}
                  {item.notes && (
                    <><span className="text-border2">·</span><span className="truncate italic">📝 {item.notes}</span></>
                  )}
                </div>
              </button>
            );
          })}

          {withoutDeadlines.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-[11px] text-txt3 uppercase tracking-wider mb-2">No deadline set</p>
              {withoutDeadlines.map((item) => (
                <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-txt3 opacity-50">
                  {item.isSubtask
                    ? <span className="text-[10px] bg-surface3 px-1.5 py-0.5 rounded">SUB</span>
                    : <span className="text-[10px] bg-surface3 px-1.5 py-0.5 rounded">TASK</span>}
                  <span className="truncate">{item.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-border shrink-0 flex items-center justify-between">
          <span className="text-xs text-txt3">{synced.size > 0 && `${synced.size} synced`}</span>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-surface3 text-txt2 hover:text-txt hover:bg-border transition-colors">Done</button>
        </div>
      </div>
    </div>
  );
}
