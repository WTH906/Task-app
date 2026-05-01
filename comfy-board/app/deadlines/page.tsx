"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { Deadline, Project, ProjectTask } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { fetchDeadlines, fetchProjects, fetchTaskDeadlines } from "@/lib/queries";
import { useToast } from "@/components/Toast";

interface AggregatedDeadline {
  id: string;
  label: string;
  date: string;
  projectTitle: string;
  projectColor: string;
  source: "deadline" | "task";
  recurrence: string | null;
}

export default function DeadlinesPage() {
  const { userId } = useCurrentUser();
  const { toast } = useToast();
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [taskDeadlines, setTaskDeadlines] = useState<AggregatedDeadline[]>([]);
  const [now, setNow] = useState(new Date());
  const [showAllModal, setShowAllModal] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();

      const [dls, projs, tasks] = await Promise.all([
        fetchDeadlines(supabase, userId),
        fetchProjects(supabase, userId),
        fetchTaskDeadlines(supabase, userId),
      ]);

      setDeadlines(dls);
      setProjects(projs);

      const projMap: Record<string, { title: string; color: string }> = {};
      for (const p of projs) projMap[p.id] = { title: p.title, color: p.color || "#e05555" };

      const tds: AggregatedDeadline[] = [];
      for (const t of tasks) {
        if (t.deadline && t.progress < 100) {
          tds.push({
            id: t.id, label: t.name, date: t.deadline,
            projectTitle: projMap[t.project_id]?.title || "Unknown",
            projectColor: projMap[t.project_id]?.color || "#e05555",
            source: "task", recurrence: null,
          });
        }
      }
      setTaskDeadlines(tds);
    } catch (err) {
      console.error("Deadlines load failed:", err);
      toast("Failed to load deadlines", "error");
    }
  }, [userId, toast]);

  useEffect(() => { document.title = "Comfy Board — Deadlines"; }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(iv); }, []);

  // Auto-renew recurring deadlines
  useEffect(() => {
    const renewRecurring = async () => {
      const supabase = createClient();
      const updates: Array<{ id: string; newDatetime: string }> = [];
      for (const d of deadlines) {
        if (!d.recurrence) continue;
        const target = new Date(d.target_datetime);
        if (target.getTime() > now.getTime()) continue;
        let next = new Date(target);
        while (next.getTime() <= now.getTime()) {
          switch (d.recurrence) {
            case "daily": next.setDate(next.getDate() + 1); break;
            case "weekly": next.setDate(next.getDate() + 7); break;
            case "monthly": next.setMonth(next.getMonth() + 1); break;
            case "yearly": next.setFullYear(next.getFullYear() + 1); break;
          }
        }
        const iso = next.toISOString();
        await supabase.from("deadlines").update({ target_datetime: iso }).eq("id", d.id);
        updates.push({ id: d.id, newDatetime: iso });
      }
      if (updates.length > 0) {
        setDeadlines((prev) => prev.map((d) => {
          const upd = updates.find((u) => u.id === d.id);
          return upd ? { ...d, target_datetime: upd.newDatetime } : d;
        }));
      }
    };
    const hasExpired = deadlines.some((d) => d.recurrence && new Date(d.target_datetime).getTime() <= now.getTime());
    if (hasExpired) renewRecurring();
  }, [deadlines, now]);

  const removeDeadline = async (id: string) => {
    const supabase = createClient();
    await supabase.from("deadlines").delete().eq("id", id);
    setDeadlines((prev) => prev.filter((d) => d.id !== id));
  };

  const getCountdown = (target: string) => {
    const diff = new Date(target).getTime() - now.getTime();
    if (diff <= 0) return { text: "Passed", passed: true };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    let text = "";
    if (days > 0) text = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    else if (hours > 0) text = `${hours}h ${minutes}m ${seconds}s`;
    else text = `${minutes}m ${seconds}s`;
    return { text, passed: false };
  };

  const getColor = (target: string) => {
    const diff = new Date(target).getTime() - now.getTime();
    if (diff <= 0) return "#5c5a7a";
    if (diff < 24 * 60 * 60 * 1000) return "#f43f5e";
    if (diff < 3 * 24 * 60 * 60 * 1000) return "#f59e0b";
    return "#4caf50";
  };

  const recurrenceLabels: Record<string, string> = {
    daily: "🔄 Daily", weekly: "🔄 Weekly", monthly: "🔄 Monthly", yearly: "🔄 Yearly",
  };

  // All deadlines combined for the modal
  const allDeadlines: AggregatedDeadline[] = [
    ...deadlines.map((d) => ({
      id: d.id, label: d.label, date: d.target_datetime.split("T")[0],
      projectTitle: "", projectColor: "#7c6fff", source: "deadline" as const,
      recurrence: d.recurrence,
    })),
    ...taskDeadlines,
  ].sort((a, b) => a.date.localeCompare(b.date));

  const today = formatDate(new Date());

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-title text-2xl text-bright">Deadlines</h1>
          <p className="text-sm text-txt2 mt-0.5">{deadlines.length} countdowns · {taskDeadlines.length} task deadlines</p>
        </div>
        <button onClick={() => setShowAllModal(true)}
          className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white transition-colors">
          Show All Deadlines
        </button>
      </div>

      {/* Countdown cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {deadlines.map((d) => {
          const { text, passed } = getCountdown(d.target_datetime);
          const color = getColor(d.target_datetime);
          const dateStr = new Date(d.target_datetime).toLocaleDateString("en-US", {
            weekday: "short", month: "short", day: "numeric", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          });

          return (
            <div key={d.id} className="bg-surface border border-border rounded-xl p-4 group card-float"
              style={{ borderLeftWidth: 3, borderLeftColor: color }}>
              <div className="flex items-start justify-between mb-2">
                <h3 className={cn("text-sm font-medium", passed ? "text-txt3" : "text-bright")}>{d.label}</h3>
                <button onClick={() => removeDeadline(d.id)}
                  className="text-xs text-txt3 hover:text-danger opacity-0 group-hover:opacity-100 transition-all">✕</button>
              </div>
              <p className="font-mono text-lg font-bold mb-1" style={{ color }}>{text}</p>
              <p className="text-[10px] text-txt3">{dateStr}</p>
              {d.recurrence && (
                <p className="text-[10px] mt-1" style={{ color }}>{recurrenceLabels[d.recurrence]}</p>
              )}
            </div>
          );
        })}
      </div>

      {deadlines.length === 0 && !showAllModal && (
        <div className="text-center py-16 text-txt3">
          <p className="text-4xl mb-3 opacity-30">⏳</p>
          <p className="text-lg font-medium text-txt2 mb-1">No countdown deadlines</p>
          <p className="text-sm">Deadlines are created automatically when you set dates on tasks</p>
        </div>
      )}

      {/* Show All Deadlines Modal */}
      {showAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAllModal(false); }}>
          <div className="bg-surface2 border border-border rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <div>
                <h2 className="font-title text-lg text-bright">All Deadlines</h2>
                <p className="text-xs text-txt3 mt-0.5">{allDeadlines.length} total · sorted by date</p>
              </div>
              <button onClick={() => setShowAllModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface3 text-txt3 hover:text-txt">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {allDeadlines.length === 0 && <p className="text-sm text-txt3 text-center py-8">No deadlines found</p>}
              {allDeadlines.map((d) => {
                const isPast = d.date < today;
                const isToday = d.date === today;
                return (
                  <div key={`${d.source}-${d.id}`}
                    className={cn("flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-2.5",
                      isPast && "opacity-50")}>
                    <span className="font-mono text-[11px] text-txt3 w-24 shrink-0">
                      {isToday ? <span className="text-danger font-bold">TODAY</span> : d.date}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-bright truncate">{d.label}</p>
                      {d.projectTitle && (
                        <p className="text-[10px] mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full inline-block mr-1" style={{ backgroundColor: d.projectColor }} />
                          <span style={{ color: d.projectColor }}>{d.projectTitle}</span>
                        </p>
                      )}
                    </div>
                    <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded",
                      d.source === "task" ? "bg-violet/10 text-violet2" : "bg-surface3 text-txt3")}>
                      {d.source === "task" ? "task" : d.recurrence ? recurrenceLabels[d.recurrence] : "countdown"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
