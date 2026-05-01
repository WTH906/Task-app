"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { cleanDeadline, detectFileType } from "@/lib/import-helpers";
import { Download, FolderOpen, Folder } from "lucide-react";

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  onComplete: () => void;
}

export function ImportModal({ open, onClose, userId, onComplete }: ImportModalProps) {
  const [dragging, setDragging] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 2_000_000; // 2MB
  const MAX_TASKS = 500;
  const MAX_STRING = 200;

  // Validation helpers
  const clampStr = (v: unknown, max = MAX_STRING): string => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.slice(0, max);
  };
  const clampInt = (v: unknown, min = 0, max = 100_000): number => {
    const n = typeof v === "number" ? Math.round(v) : parseInt(String(v)) || 0;
    return Math.max(min, Math.min(max, n));
  };

  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setImporting(true);
    setDone(false);
    const lines: string[] = [`Importing ${files.length} file(s)...\n`];
    setLog([...lines]);

    const supabase = createClient();

    for (const file of files) {
      try {
        // File size check
        if (file.size > MAX_FILE_SIZE) {
          lines.push(`✗ ${file.name}: file too large (${(file.size / 1_000_000).toFixed(1)}MB, max 2MB)`);
          setLog([...lines]);
          continue;
        }

        const text = await file.text();
        const data = JSON.parse(text);
        const type = detectFileType(data);
        lines.push(`📄 ${file.name} → ${type}`);
        setLog([...lines]);

        switch (type) {
          case "project":
            await importProject(supabase, data, lines);
            break;
          case "template":
            await importTemplate(supabase, data, lines);
            break;
          case "projects_list":
            await importProjectsList(supabase, data, lines);
            break;
          case "routine":
            await importRoutine(supabase, data, lines);
            break;
          default:
            lines.push("  ⚠ Unknown format, trying as project...");
            await importProject(supabase, data, lines);
        }
      } catch (err) {
        lines.push(`✗ ${file.name}: ${err instanceof Error ? err.message : "Invalid JSON"}`);
      }
      setLog([...lines]);
    }

    lines.push("\n✅ All done!");
    setLog([...lines]);
    setImporting(false);
    setDone(true);
    onComplete();
  }, [userId, onComplete]);

  async function importProject(
    supabase: ReturnType<typeof createClient>,
    data: Record<string, unknown>,
    log: string[]
  ) {
    const title = clampStr(data.title || data.name || "Imported");
    const rawTasks = (data.tasks || []) as Array<Record<string, unknown>>;

    if (!title) { log.push("  ✗ Missing project title"); return; }
    if (rawTasks.length > MAX_TASKS) {
      log.push(`  ✗ Too many tasks (${rawTasks.length}, max ${MAX_TASKS})`);
      return;
    }

    const { data: proj } = await supabase
      .from("projects")
      .insert({
        user_id: userId, title,
        description: clampStr(data.description, 2000),
        elapsed_seconds: clampInt(data.elapsed_seconds),
        sort_order: 999,
      })
      .select().single();

    if (!proj) { log.push(`  ✗ Failed to create "${title}"`); return; }

    // Bulk insert tasks
    const taskInserts = rawTasks.slice(0, MAX_TASKS).map((t, i) => ({
      project_id: proj.id, user_id: userId,
      name: clampStr(t.name) || `Task ${i + 1}`,
      est_minutes: clampInt(t.est_minutes),
      deadline: cleanDeadline(t.deadline),
      progress: clampInt(t.progress, 0, 100),
      notes: clampStr(t.notes, 2000),
      elapsed_seconds: clampInt(t.elapsed_seconds),
      sort_order: i,
    }));

    const { data: insertedTasks } = await supabase
      .from("project_tasks")
      .insert(taskInserts)
      .select("id");

    if (!insertedTasks) { log.push(`  ✗ Failed to insert tasks`); return; }

    let sc = 0;
    for (let i = 0; i < rawTasks.length && i < insertedTasks.length; i++) {
      const subs = (rawTasks[i].subtasks || []) as Array<Record<string, unknown>>;
      if (subs.length === 0) continue;

      const subInserts = subs.slice(0, MAX_TASKS).map((s, j) => ({
        task_id: insertedTasks[i].id, user_id: userId,
        name: clampStr(s.name) || `Subtask ${j + 1}`,
        est_minutes: clampInt(s.est_minutes),
        deadline: cleanDeadline(s.deadline),
        progress: clampInt(s.progress, 0, 100),
        notes: clampStr(s.notes, 2000),
        sort_order: j,
      }));

      await supabase.from("subtasks").insert(subInserts);
      sc += subInserts.length;

      // Recalc parent progress
      const avg = Math.round(subInserts.reduce((sum, s) => sum + s.progress, 0) / subInserts.length);
      await supabase.from("project_tasks").update({ progress: avg }).eq("id", insertedTasks[i].id);
    }
    log.push(`  ✓ "${title}" — ${insertedTasks.length} tasks, ${sc} subtasks`);
  }

  async function importTemplate(
    supabase: ReturnType<typeof createClient>,
    data: Record<string, unknown>,
    log: string[]
  ) {
    const name = clampStr(data.name) || "Imported Template";
    const tasks = (data.tasks || []) as Array<Record<string, unknown>>;
    if (tasks.length > MAX_TASKS) { log.push(`  ✗ Too many tasks (${tasks.length}, max ${MAX_TASKS})`); return; }
    const taskData = tasks.slice(0, MAX_TASKS).map((t) => ({
      name: clampStr(t.name), est_minutes: clampInt(t.est_minutes),
      deadline: cleanDeadline(t.deadline), progress: 0, notes: clampStr(t.notes, 2000),
      subtasks: ((t.subtasks || []) as Array<Record<string, unknown>>).slice(0, MAX_TASKS).map((s) => ({
        name: clampStr(s.name), est_minutes: clampInt(s.est_minutes),
        deadline: cleanDeadline(s.deadline), progress: 0, notes: clampStr(s.notes, 2000),
      })),
      elapsed_seconds: 0,
    }));
    await supabase.from("templates").insert({ user_id: userId, name, task_data: taskData });
    log.push(`  ✓ Template "${name}" — ${taskData.length} tasks`);
  }

  async function importProjectsList(
    supabase: ReturnType<typeof createClient>,
    data: Record<string, unknown>,
    log: string[]
  ) {
    const list = (data.projects || []) as Array<{ title: string }>;
    let count = 0;
    for (const p of list) {
      const { data: existing } = await supabase
        .from("projects").select("id").eq("user_id", userId).eq("title", p.title).is("archived_at", null).maybeSingle();
      if (existing) continue;
      await supabase.from("projects").insert({ user_id: userId, title: p.title, sort_order: 999 + count });
      count++;
    }
    log.push(`  ✓ ${count} projects created (${list.length - count} already existed)`);
  }

  async function importRoutine(
    supabase: ReturnType<typeof createClient>,
    data: Record<string, unknown>,
    log: string[]
  ) {
    const tasks = (data.tasks || []) as Array<{ text?: string; name?: string; est_minutes?: number }>;
    if (tasks.length === 0) { log.push("  ⏭ No routine tasks"); return; }
    const inserts = tasks
      .map((t, i) => ({ user_id: userId, text: clampStr(t.text || t.name), est_minutes: clampInt(t.est_minutes), sort_order: i }))
      .filter((t) => t.text.length > 0)
      .slice(0, MAX_TASKS);
    if (inserts.length === 0) { log.push("  ⏭ No valid routine tasks"); return; }
    await supabase.from("routine_tasks").insert(inserts);
    log.push(`  ✓ ${inserts.length} routine tasks imported`);
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith(".json"));
    processFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleClose = () => {
    setLog([]);
    setDone(false);
    setImporting(false);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget && !importing) handleClose(); }}>
      <div className="bg-surface2 border border-border rounded-xl max-w-lg w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-title text-bright text-lg flex items-center gap-2"><Download size={18} /> Import Data</h2>
            <p className="text-xs text-txt3 mt-0.5">Drag & drop JSON files or click to browse</p>
          </div>
          {!importing && (
            <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface3 text-txt3 hover:text-txt">✕</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Drop zone */}
          {log.length === 0 && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragging
                  ? "border-green-acc bg-green-acc/5 scale-[1.02]"
                  : "border-border2 hover:border-violet/50 hover:bg-violet/5"
              }`}
            >
              <div className="text-3xl mb-3 flex justify-center">{dragging ? <FolderOpen size={40} className="text-violet2" /> : <Folder size={40} className="text-txt3" />}</div>
              <p className="text-sm text-bright mb-1">
                {dragging ? "Drop files here!" : "Drag & drop your JSON files here"}
              </p>
              <p className="text-xs text-txt3 mb-3">or click to browse</p>
              <div className="flex flex-wrap justify-center gap-2 text-[10px] text-txt3">
                <span className="bg-surface3 px-2 py-1 rounded">Projects</span>
                <span className="bg-surface3 px-2 py-1 rounded">Templates</span>
                <span className="bg-surface3 px-2 py-1 rounded">projects.json</span>
                <span className="bg-surface3 px-2 py-1 rounded">tasks.json</span>
              </div>
              <input ref={inputRef} type="file" accept=".json,.csv" multiple onChange={handleFileSelect} className="hidden" />
            </div>
          )}

          {/* Log */}
          {log.length > 0 && (
            <div className="font-mono text-xs whitespace-pre-wrap bg-bg rounded-lg p-4 space-y-0.5 max-h-60 overflow-y-auto">
              {log.map((line, i) => (
                <p key={i} className={
                  line.startsWith("  ✓") || line.startsWith("✓") ? "text-green-acc" :
                  line.startsWith("  ✗") || line.startsWith("✗") ? "text-danger" :
                  line.startsWith("  ⏭") || line.startsWith("⏭") ? "text-amber" :
                  line.startsWith("✅") ? "text-green-acc font-bold" :
                  line.startsWith("📄") ? "text-violet2" :
                  "text-txt2"
                }>{line}</p>
              ))}
              {importing && <p className="text-txt3 animate-pulse">Working...</p>}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-border shrink-0 flex items-center justify-between">
          {done && !importing ? (
            <>
              <button onClick={() => { setLog([]); setDone(false); }}
                className="text-xs text-txt3 hover:text-violet2 transition-colors">Import more</button>
              <button onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white transition-colors">Done</button>
            </>
          ) : (
            <span className="text-xs text-txt3">{importing ? "Importing..." : "Supports multiple files"}</span>
          )}
        </div>
      </div>
    </div>
  );
}
