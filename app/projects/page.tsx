"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Project, Template } from "@/lib/types";
import { ProgressBar } from "@/components/ProgressBar";
import { Modal } from "@/components/Modal";
import { cn } from "@/lib/utils";
import { cleanDeadline, detectFileType } from "@/lib/import-helpers";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [userId, setUserId] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data } = await supabase
        .from("projects")
        .select("*")
        .eq("user_id", user.id)
        .order("sort_order");
      setProjects(data || []);

      const { data: tmpl } = await supabase
        .from("templates")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setTemplates(tmpl || []);
    };
    load();
  }, []);

  const notifySidebar = () => window.dispatchEvent(new Event("projects-changed"));

  const reload = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order");
    setProjects(data || []);
    const { data: tmpl } = await supabase
      .from("templates")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setTemplates(tmpl || []);
    notifySidebar();
  };

  const createProject = async () => {
    const title = prompt("Project name:");
    if (!title?.trim()) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("projects")
      .insert({ user_id: userId, title: title.trim(), sort_order: projects.length })
      .select()
      .single();
    if (data) { notifySidebar(); router.push(`/projects/${data.id}`); }
  };

  // ─── Import single project JSON ───
  const importSingleProject = async (
    supabase: ReturnType<typeof createClient>,
    data: Record<string, unknown>,
    log: string[]
  ) => {
    const title = (data.title || data.name || "Imported") as string;
    const tasks = (data.tasks || []) as Array<Record<string, unknown>>;

    const { data: proj } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        title,
        description: (data.description as string) || "",
        elapsed_seconds: (data.elapsed_seconds as number) || 0,
        alarm_fired: (data.alarm_fired as boolean) || false,
        sort_order: projects.length,
      })
      .select()
      .single();

    if (!proj) { log.push(`✗ Failed to create project "${title}"`); return null; }

    let taskCount = 0;
    let subtaskCount = 0;

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const { data: task } = await supabase
        .from("project_tasks")
        .insert({
          project_id: proj.id,
          user_id: userId,
          name: t.name as string,
          est_minutes: (t.est_minutes as number) || 0,
          deadline: cleanDeadline(t.deadline),
          progress: (t.progress as number) || 0,
          notes: (t.notes as string) || "",
          elapsed_seconds: (t.elapsed_seconds as number) || 0,
          sort_order: i,
        })
        .select()
        .single();

      if (!task) continue;
      taskCount++;

      const subs = (t.subtasks || []) as Array<Record<string, unknown>>;
      if (subs.length > 0) {
        for (let j = 0; j < subs.length; j++) {
          const s = subs[j];
          await supabase.from("subtasks").insert({
            task_id: task.id,
            user_id: userId,
            name: s.name as string,
            est_minutes: (s.est_minutes as number) || 0,
            deadline: cleanDeadline(s.deadline),
            progress: (s.progress as number) || 0,
            notes: (s.notes as string) || "",
            sort_order: j,
          });
          subtaskCount++;
        }

        // Recalc parent progress
        const avg = Math.round(
          subs.reduce((sum, s) => sum + ((s.progress as number) || 0), 0) / subs.length
        );
        await supabase.from("project_tasks").update({ progress: avg }).eq("id", task.id);
      }
    }

    log.push(`✓ Project "${title}" — ${taskCount} tasks, ${subtaskCount} subtasks`);
    return proj;
  };

  // ─── Import template JSON ───
  const importTemplate = async (
    supabase: ReturnType<typeof createClient>,
    data: Record<string, unknown>,
    log: string[]
  ) => {
    const name = (data.name as string) || "Imported Template";
    const tasks = (data.tasks || []) as Array<Record<string, unknown>>;

    const taskData = tasks.map((t) => ({
      name: t.name as string,
      est_minutes: (t.est_minutes as number) || 0,
      deadline: cleanDeadline(t.deadline),
      progress: 0,
      notes: (t.notes as string) || "",
      subtasks: ((t.subtasks || []) as Array<Record<string, unknown>>).map((s) => ({
        name: s.name as string,
        est_minutes: (s.est_minutes as number) || 0,
        deadline: cleanDeadline(s.deadline),
        progress: 0,
        notes: (s.notes as string) || "",
      })),
      elapsed_seconds: 0,
    }));

    await supabase.from("templates").insert({
      user_id: userId,
      name,
      task_data: taskData,
    });

    log.push(`✓ Template "${name}" — ${taskData.length} tasks`);
  };

  // ─── Import projects list (bulk names) ───
  const importProjectsList = async (
    supabase: ReturnType<typeof createClient>,
    data: Record<string, unknown>,
    log: string[]
  ) => {
    const list = (data.projects || []) as Array<{ id?: string; title: string }>;
    let count = 0;
    for (const p of list) {
      // Check if already exists
      const { data: existing } = await supabase
        .from("projects")
        .select("id")
        .eq("user_id", userId)
        .eq("title", p.title)
        .maybeSingle();

      if (existing) {
        log.push(`⏭ Project "${p.title}" already exists, skipped`);
        continue;
      }

      await supabase.from("projects").insert({
        user_id: userId,
        title: p.title,
        sort_order: projects.length + count,
      });
      count++;
    }
    log.push(`✓ Created ${count} empty projects from list (${list.length - count} skipped)`);
  };

  // ─── Import routine tasks ───
  const importRoutine = async (
    supabase: ReturnType<typeof createClient>,
    data: Record<string, unknown>,
    log: string[]
  ) => {
    const tasks = (data.tasks || []) as Array<{ text?: string; name?: string; est_minutes?: number }>;
    if (tasks.length === 0) { log.push("⏭ Routine file has no tasks"); return; }
    let count = 0;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const text = t.text || t.name;
      if (!text) continue;
      await supabase.from("routine_tasks").insert({
        user_id: userId,
        text,
        est_minutes: t.est_minutes || 0,
        sort_order: i,
      });
      count++;
    }
    log.push(`✓ Imported ${count} routine tasks`);
  };

  // ─── Main import handler (multi-file) ───
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const supabase = createClient();
    const log: string[] = [];
    log.push(`Importing ${files.length} file(s)...`);

    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const type = detectFileType(data);

        log.push(`\n📄 ${file.name} → detected as: ${type}`);

        switch (type) {
          case "project":
            await importSingleProject(supabase, data, log);
            break;
          case "template":
            await importTemplate(supabase, data, log);
            break;
          case "projects_list":
            await importProjectsList(supabase, data, log);
            break;
          case "routine":
            await importRoutine(supabase, data, log);
            break;
          default:
            // Try as project anyway
            log.push("  ⚠ Unknown format, trying as project...");
            await importSingleProject(supabase, data, log);
        }
      } catch (err) {
        log.push(`✗ ${file.name}: ${err instanceof Error ? err.message : "Invalid JSON"}`);
      }
    }

    log.push("\n✅ Import complete!");
    setImportLog(log);
    setImportModalOpen(true);
    await reload();

    if (importRef.current) importRef.current.value = "";
  };

  // Load from template
  const loadTemplate = async (template: Template) => {
    const title = prompt("Project name:", template.name);
    if (!title?.trim()) return;
    const supabase = createClient();
    const { data: proj } = await supabase
      .from("projects")
      .insert({ user_id: userId, title: title.trim(), sort_order: projects.length })
      .select()
      .single();

    if (!proj) return;

    const tasksData = template.task_data as Array<{
      name: string; est_minutes?: number; deadline?: string | null;
      notes?: string; elapsed_seconds?: number;
      subtasks?: Array<{ name: string; est_minutes?: number; deadline?: string | null; notes?: string }>;
    }>;

    for (let i = 0; i < tasksData.length; i++) {
      const t = tasksData[i];
      const { data: task } = await supabase
        .from("project_tasks")
        .insert({
          project_id: proj.id, user_id: userId, name: t.name,
          est_minutes: t.est_minutes || 0, deadline: cleanDeadline(t.deadline),
          progress: 0, notes: t.notes || "", elapsed_seconds: 0, sort_order: i,
        })
        .select().single();

      if (task && t.subtasks) {
        for (let j = 0; j < t.subtasks.length; j++) {
          const s = t.subtasks[j];
          await supabase.from("subtasks").insert({
            task_id: task.id, user_id: userId, name: s.name,
            est_minutes: s.est_minutes || 0, deadline: cleanDeadline(s.deadline),
            progress: 0, notes: s.notes || "", sort_order: j,
          });
        }
      }
    }

    setTemplateModalOpen(false);
    notifySidebar();
    router.push(`/projects/${proj.id}`);
  };

  const deleteTemplate = async (id: string) => {
    const supabase = createClient();
    await supabase.from("templates").delete().eq("id", id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  // Drag and drop
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newList = [...projects];
    const [moved] = newList.splice(dragIdx, 1);
    newList.splice(idx, 0, moved);
    setProjects(newList);
    setDragIdx(idx);
  };
  const handleDragEnd = async () => {
    setDragIdx(null);
    const supabase = createClient();
    await Promise.all(projects.map((p, i) =>
      supabase.from("projects").update({ sort_order: i }).eq("id", p.id)
    ));
    notifySidebar();
  };

  const deleteProject = async (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    if (!confirm(`Delete project "${title}"?`)) return;
    const supabase = createClient();
    await supabase.from("projects").delete().eq("id", id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    notifySidebar();
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-title text-2xl text-bright">Projects</h1>
          <p className="text-sm text-txt2 mt-1">{projects.length} projects · drag to reorder</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setTemplateModalOpen(true)}
            className="px-3 py-2 rounded-lg text-sm bg-surface border border-border text-txt2 hover:text-violet2 hover:border-violet/30 transition-colors">
            📋 Templates
          </button>
          <label className="px-3 py-2 rounded-lg text-sm bg-surface border border-border text-txt2 hover:text-green-acc hover:border-green-acc/30 transition-colors cursor-pointer">
            📥 Import
            <input ref={importRef} type="file" accept=".json" multiple onChange={handleImport} className="hidden" />
          </label>
          <button onClick={createProject}
            className="px-4 py-2 rounded-lg text-sm bg-red-acc hover:bg-red-dark text-white transition-colors">
            ＋ New Project
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {projects.map((p, idx) => (
          <div key={p.id} draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            onClick={() => router.push(`/projects/${p.id}`)}
            className={cn(
              "bg-surface border border-border rounded-xl p-4 text-left hover:border-border2 transition-all group cursor-pointer",
              dragIdx === idx && "opacity-50 scale-[0.98]"
            )}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="cursor-grab text-txt3 opacity-0 group-hover:opacity-100 transition-opacity select-none shrink-0">⠿</span>
                <h3 className="text-bright font-medium group-hover:text-red-acc transition-colors truncate">{p.title}</h3>
              </div>
              <button onClick={(e) => deleteProject(e, p.id, p.title)}
                className="text-txt3 hover:text-danger opacity-0 group-hover:opacity-100 transition-all text-sm shrink-0">✕</button>
            </div>
            {p.description && <p className="text-sm text-txt3 mt-1 line-clamp-2 ml-6">{p.description}</p>}
            <div className="mt-3 ml-6"><ProgressBar value={0} height={4} /></div>
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <div className="text-center py-16 text-txt3">
          <p className="text-lg mb-2">No projects yet</p>
          <p className="text-sm mb-4">Create a project, import from JSON, or load a template</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button onClick={createProject} className="px-4 py-2 rounded-lg text-sm bg-red-acc hover:bg-red-dark text-white">Create Project</button>
            <label className="px-4 py-2 rounded-lg text-sm bg-surface border border-border text-txt2 hover:text-green-acc cursor-pointer">
              📥 Import JSON
              <input type="file" accept=".json" multiple onChange={handleImport} className="hidden" />
            </label>
          </div>
        </div>
      )}

      {/* Import Results Modal */}
      <Modal open={importModalOpen} onClose={() => setImportModalOpen(false)} title="Import Results" maxWidth="max-w-lg">
        <div className="space-y-1 font-mono text-xs whitespace-pre-wrap bg-bg rounded-lg p-4 max-h-80 overflow-y-auto">
          {importLog.map((line, i) => (
            <p key={i} className={
              line.startsWith("✓") ? "text-green-acc" :
              line.startsWith("✗") ? "text-danger" :
              line.startsWith("⏭") ? "text-amber" :
              line.startsWith("✅") ? "text-green-acc font-bold" :
              "text-txt2"
            }>{line}</p>
          ))}
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={() => setImportModalOpen(false)} className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white">Done</button>
        </div>
      </Modal>

      {/* Templates Modal */}
      <Modal open={templateModalOpen} onClose={() => setTemplateModalOpen(false)} title="Project Templates" maxWidth="max-w-lg">
        <div className="space-y-2">
          {templates.length === 0 && (
            <p className="text-sm text-txt3 text-center py-6">
              No templates yet. Open a project and click "💾 Template" to save one,<br/>or import a template JSON file.
            </p>
          )}
          {templates.map((t) => {
            const taskCount = Array.isArray(t.task_data) ? t.task_data.length : 0;
            return (
              <div key={t.id} className="flex items-center justify-between bg-surface border border-border rounded-lg px-4 py-3 group">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm text-bright font-medium truncate">{t.name}</h4>
                  <p className="text-xs text-txt3">{taskCount} task{taskCount !== 1 ? "s" : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => loadTemplate(t)} className="px-3 py-1.5 rounded-lg text-xs bg-violet/10 text-violet2 hover:bg-violet/20">Use</button>
                  <button onClick={() => deleteTemplate(t.id)} className="text-txt3 hover:text-danger opacity-0 group-hover:opacity-100 transition-all text-sm">✕</button>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
