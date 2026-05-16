"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { MonitoredTask } from "@/lib/types";
import { useToast } from "@/components/Toast";
import { X, CheckCircle, Clock, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

export function MonitoringPanel({ open, onClose, userId }: { open: boolean; onClose: () => void; userId: string }) {
  const [items, setItems] = useState<MonitoredTask[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const router = useRouter();

  const goToTask = (item: MonitoredTask) => {
    if (item.project_id) {
      // If it's a subtask, tell the project page to expand the parent task
      if (item.task_id) {
        window.dispatchEvent(new CustomEvent("expand-task", { detail: item.task_id }));
      }
      router.push(`/projects/${item.project_id}`);
      onClose();
    }
  };

  const loadData = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("monitored_tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "waiting")
      .order("added_at", { ascending: false });
    setItems((data || []) as MonitoredTask[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { if (open) loadData(); }, [open, loadData]);

  // Reload when tasks are added/removed from monitoring
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("monitoring-changed", handler);
    return () => window.removeEventListener("monitoring-changed", handler);
  }, [loadData]);

  // Escape closes panel
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const resolve = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    const supabase = createClient();
    await supabase.from("monitored_tasks").update({ status: "resolved" }).eq("id", id);
    // Remove orange flag from task/subtask
    const item = items.find(i => i.id === id);
    if (item?.subtask_id) {
      supabase.from("subtasks").update({ monitoring: false }).eq("id", item.subtask_id);
    } else if (item?.task_id) {
      supabase.from("project_tasks").update({ monitoring: false }).eq("id", item.task_id);
    }
    toast("Resolved", "success");
  };

  const updateNotes = async (id: string, notes: string) => {
    const supabase = createClient();
    supabase.from("monitored_tasks").update({ notes }).eq("id", id);
    setItems(prev => prev.map(i => i.id === id ? { ...i, notes } : i));
  };

  // Group by project
  const byProject: Record<string, { title: string; items: MonitoredTask[] }> = {};
  for (const item of items) {
    const key = item.project_id || "_none";
    if (!byProject[key]) byProject[key] = { title: item.project_title || "No project", items: [] };
    byProject[key].items.push(item);
  }

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapse = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  if (!open) return null;

  return (
    <>
      {open && <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.3)" }} onClick={onClose} />}
      <div
        className="fixed top-0 bottom-0 z-50 flex flex-col border-r w-full sm:w-[400px]"
        style={{
          left: 0,
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s ease-in-out, visibility 0.3s",
          visibility: open ? "visible" : "hidden",
          background: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          <Clock size={16} className="text-amber" />
          <h2 className="font-title text-lg text-bright flex-1">Monitoring</h2>
          <span className="text-xs text-txt3 font-mono">{items.length}</span>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface2 text-txt3 hover:text-txt">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center py-16 text-txt3 text-xs">Loading...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-txt3">
              <p className="text-2xl mb-2">✓</p>
              <p className="text-sm">Nothing on standby</p>
              <p className="text-[10px] mt-1">Use the ⋯ menu on any task → "Monitor" to track it here</p>
            </div>
          ) : (
            <div className="py-2">
              {Object.entries(byProject).map(([key, group]) => (
                <div key={key}>
                  <button onClick={() => toggleCollapse(key)}
                    className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold text-txt2 hover:bg-surface2 transition-colors">
                    {collapsed[key] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="flex-1 text-left">{group.title}</span>
                    <span className="text-[10px] text-txt3 font-mono">{group.items.length}</span>
                  </button>
                  {!collapsed[key] && group.items.map(item => (
                    <div key={item.id} className="px-4 py-2.5 mx-2 mb-1 rounded-lg bg-surface2 border border-border">
                      <div className="flex items-center gap-2">
                        <button onClick={() => goToTask(item)} className="text-xs font-medium text-bright flex-1 truncate text-left hover:text-violet2 transition-colors" title="Go to project">
                          {item.task_name}
                        </button>
                        <button onClick={() => resolve(item.id)} title="Mark as resolved"
                          className="w-6 h-6 rounded flex items-center justify-center text-txt3 hover:text-green-acc hover:bg-green-acc/10 transition-colors shrink-0">
                          <CheckCircle size={14} />
                        </button>
                      </div>
                      <div className="text-[10px] text-txt3 mt-1">
                        Added {new Date(item.added_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </div>
                      <textarea
                        value={item.notes}
                        onChange={(e) => updateNotes(item.id, e.target.value)}
                        placeholder="Why is this on standby..."
                        className="w-full mt-1.5 bg-surface3 border border-border rounded px-2 py-1 text-[11px] text-txt placeholder-txt3 resize-none focus:outline-none focus:border-violet h-12"
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
