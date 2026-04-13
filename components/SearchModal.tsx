"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Folder, Pin, CornerDownRight, ListChecks, Timer, Search } from "lucide-react";

interface SearchResult {
  type: "project" | "task" | "subtask" | "routine" | "deadline";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  color?: string;
}

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery(""); setResults([]); setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const { createClient } = await import("@/lib/supabase");
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSearching(false); return; }

      const term = `%${q.trim()}%`;
      const items: SearchResult[] = [];

      const { data: projects } = await supabase
        .from("projects").select("id, title, color").eq("user_id", user.id).is("archived_at", null).ilike("title", term).limit(5);
      for (const p of projects || [])
        items.push({ type: "project", id: p.id, title: p.title, subtitle: "Project", href: `/projects/${p.id}`, color: p.color });

      const { data: tasks } = await supabase
        .from("project_tasks").select("id, name, project_id, notes").eq("user_id", user.id).is("archived_at", null)
        .or(`name.ilike.${term},notes.ilike.${term}`).limit(8);
      for (const t of tasks || [])
        items.push({ type: "task", id: t.id, title: t.name, subtitle: t.notes?.slice(0, 60) || "Task", href: `/projects/${t.project_id}` });

      const { data: routines } = await supabase
        .from("routine_tasks").select("id, text").eq("user_id", user.id).ilike("text", term).limit(3);
      for (const r of routines || [])
        items.push({ type: "routine", id: r.id, title: r.text, subtitle: "Routine task", href: "/routine" });

      const { data: dls } = await supabase
        .from("deadlines").select("id, label").eq("user_id", user.id).ilike("label", term).limit(3);
      for (const d of dls || [])
        items.push({ type: "deadline", id: d.id, title: d.label, subtitle: "Deadline", href: "/deadlines" });

      setResults(items);
      setSelected(0);
    } catch { /* ignore */ }
    setSearching(false);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => search(query), 250);
    return () => clearTimeout(timeout);
  }, [query, search]);

  const handleNavigate = (href: string) => {
    onClose();
    if (href && href !== "#") {
      router.push(href);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && results[selected]) { handleNavigate(results[selected].href); }
    if (e.key === "Escape") onClose();
  };

  const typeIcon: Record<string, React.ReactNode> = {
    project: <Folder size={13} />, task: <Pin size={13} />, subtask: <CornerDownRight size={13} />,
    routine: <ListChecks size={13} />, deadline: <Timer size={13} />,
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] p-4 modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface2 border border-border rounded-xl max-w-lg w-full shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <span className="text-txt3"><Search size={16} /></span>
          <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey} placeholder="Search projects, tasks, deadlines..."
            className="flex-1 bg-transparent text-txt text-sm placeholder-txt3 outline-none" />
          <kbd className="text-[10px] text-txt3 bg-surface3 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {searching && <p className="text-xs text-txt3 text-center py-4 animate-pulse">Searching...</p>}
          {!searching && query && results.length === 0 && (
            <p className="text-xs text-txt3 text-center py-6">No results for &ldquo;{query}&rdquo;</p>
          )}
          {results.map((r, i) => (
            <button key={`${r.type}-${r.id}`}
              onClick={() => handleNavigate(r.href)}
              onMouseEnter={() => setSelected(i)}
              className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors ${
                i === selected ? "bg-violet/10" : "hover:bg-surface3"
              }`}>
              <span className="text-sm">{typeIcon[r.type]}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-bright truncate">{r.title}</p>
                <p className="text-[11px] text-txt3 truncate">{r.subtitle}</p>
              </div>
              {r.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />}
            </button>
          ))}
        </div>
        {!query && (
          <div className="px-4 py-3 text-[11px] text-txt3 border-t border-border">
            Type to search · <kbd className="bg-surface3 px-1 py-0.5 rounded">↑↓</kbd> navigate · <kbd className="bg-surface3 px-1 py-0.5 rounded">↵</kbd> open
          </div>
        )}
      </div>
    </div>
  );
}
