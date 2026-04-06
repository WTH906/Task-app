"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { User } from "@supabase/supabase-js";
import { Project, Template } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ImportModal } from "./ImportModal";
import { SearchModal } from "./SearchModal";

export function Sidebar({ user }: { user: User }) {
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const fetchProjects = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("projects").select("*").eq("user_id", user.id).order("sort_order");
    setProjects(data || []);
  }, [user.id]);

  const fetchTemplates = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("templates").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setTemplates(data || []);
  }, [user.id]);

  useEffect(() => {
    fetchProjects(); fetchTemplates();
    const handler = () => { fetchProjects(); fetchTemplates(); };
    window.addEventListener("projects-changed", handler);
    const supabase = createClient();
    const channel = supabase.channel("projects-sidebar")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `user_id=eq.${user.id}` }, () => fetchProjects())
      .subscribe();
    return () => { window.removeEventListener("projects-changed", handler); supabase.removeChannel(channel); };
  }, [user.id, fetchProjects, fetchTemplates]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Ctrl/Cmd+K for search — works even in inputs
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      // Skip other shortcuts if in input
      if (isInput) return;

      // Quick nav shortcuts
      if (e.key === "d") { e.preventDefault(); window.location.href = "/"; }
      if (e.key === "r") { e.preventDefault(); window.location.href = "/routine"; }
      if (e.key === "w") { e.preventDefault(); window.location.href = "/week"; }
      if (e.key === "n") { e.preventDefault(); handleNewProject(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const navItems = [
    { href: "/", icon: "🏠", label: "Dashboard", accent: "violet", key: "D" },
    { href: "/routine", icon: "☰", label: "Daily Routine", accent: "red-acc", key: "R" },
    { href: "/weekly-routine", icon: "🔄", label: "Weekly Routine", accent: "violet", key: "" },
    { href: "/week", icon: "📅", label: "Week", accent: "violet", key: "W" },
    { href: "/retro", icon: "📊", label: "Retro Planning", accent: "violet", key: "" },
    { href: "/deadlines", icon: "⏳", label: "Deadlines", accent: "violet", key: "" },
  ];

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleNewProject = async () => {
    const title = prompt("Project name:");
    if (!title?.trim()) return;
    const supabase = createClient();
    const { data } = await supabase.from("projects")
      .insert({ user_id: user.id, title: title.trim(), sort_order: projects.length })
      .select().single();
    if (data) { window.dispatchEvent(new Event("projects-changed")); router.push(`/projects/${data.id}`); }
  };

  const createFromTemplate = async (template: Template) => {
    const title = prompt("Project name:", template.name);
    if (!title?.trim()) return;
    const supabase = createClient();
    const { data: proj } = await supabase.from("projects")
      .insert({ user_id: user.id, title: title.trim(), sort_order: projects.length })
      .select().single();
    if (!proj) return;

    const tasksData = template.task_data as Array<{
      name: string; est_minutes?: number; deadline?: string | null; notes?: string;
      subtasks?: Array<{ name: string; est_minutes?: number; deadline?: string | null; notes?: string }>;
    }>;
    for (let i = 0; i < tasksData.length; i++) {
      const t = tasksData[i];
      const dl = t.deadline && t.deadline !== "\u2014" ? t.deadline : null;
      const { data: task } = await supabase.from("project_tasks").insert({
        project_id: proj.id, user_id: user.id, name: t.name, est_minutes: t.est_minutes || 0,
        deadline: dl, progress: 0, notes: t.notes || "", elapsed_seconds: 0, sort_order: i,
      }).select().single();
      if (task && t.subtasks) {
        for (let j = 0; j < t.subtasks.length; j++) {
          const s = t.subtasks[j];
          await supabase.from("subtasks").insert({
            task_id: task.id, user_id: user.id, name: s.name, est_minutes: s.est_minutes || 0,
            deadline: s.deadline && s.deadline !== "\u2014" ? s.deadline : null,
            progress: 0, notes: s.notes || "", sort_order: j,
          });
        }
      }
    }
    setTemplateOpen(false);
    window.dispatchEvent(new Event("projects-changed"));
    router.push(`/projects/${proj.id}`);
  };

  const deleteTemplate = async (id: string) => {
    const supabase = createClient();
    await supabase.from("templates").delete().eq("id", id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <>
      <button onClick={() => setOpen(!open)}
        className="fixed top-3 left-3 z-50 md:hidden w-10 h-10 flex items-center justify-center bg-surface2 rounded-lg border border-border">
        <span className="text-lg">{open ? "✕" : "☰"}</span>
      </button>
      {open && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setOpen(false)} />}

      <aside className={cn(
        "fixed top-0 left-0 h-full w-60 bg-surface border-r border-border z-40 flex flex-col transition-transform duration-200",
        !open && "-translate-x-full md:translate-x-0"
      )}>
        <div className="p-4 border-b border-border">
          <h1 className="font-title text-lg text-bright tracking-wide">Comfy Board</h1>
          <p className="text-xs text-txt3 mt-0.5 truncate">{user.email}</p>
        </div>

        <button onClick={() => setSearchOpen(true)}
          className="mx-2 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface2 border border-border text-sm text-txt3 hover:text-txt hover:border-border2 transition-colors">
          <span>🔍</span><span className="flex-1 text-left">Search...</span>
          <kbd className="text-[9px] bg-surface3 px-1 py-0.5 rounded">⌘K</kbd>
        </button>

        <nav className="flex-1 overflow-y-auto p-2 space-y-1 mt-1">
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" : (pathname === item.href || pathname.startsWith(item.href + "/"));
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  active ? "" : "text-txt2 hover:bg-surface2 hover:text-txt")}
                style={active ? {
                  backgroundColor: item.accent === "violet" ? "rgba(124,111,255,0.15)" : "rgba(224,85,85,0.15)",
                  color: item.accent === "violet" ? "#a594ff" : "#e05555",
                } : undefined}>
                <span className="text-base">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.key && <kbd className="text-[9px] text-txt3 bg-surface3 px-1 py-0.5 rounded">{item.key}</kbd>}
              </Link>
            );
          })}

          <div className="border-t border-border my-3" />

          <div className="px-3 mb-1 flex items-center justify-between">
            <Link href="/projects" onClick={() => setOpen(false)}
              className="text-[11px] uppercase tracking-wider text-txt3 hover:text-red-acc transition-colors">Projects</Link>
            <div className="flex items-center gap-1">
              <button onClick={() => setImportOpen(true)} title="Import" className="text-xs text-txt3 hover:text-green-acc transition-colors p-0.5">📥</button>
              <button onClick={() => { fetchTemplates(); setTemplateOpen(!templateOpen); }} title="Templates" className="text-xs text-txt3 hover:text-violet2 transition-colors p-0.5">📋</button>
            </div>
          </div>

          {templateOpen && (
            <div className="mx-2 mb-2 bg-surface2 border border-border rounded-lg overflow-hidden">
              {templates.length === 0 ? (
                <p className="text-[11px] text-txt3 px-3 py-2 text-center">No templates</p>
              ) : templates.map((t) => (
                <div key={t.id} className="flex items-center border-b border-border/50 last:border-b-0 group">
                  <button onClick={() => createFromTemplate(t)}
                    className="flex-1 text-left px-3 py-2 text-xs text-txt2 hover:bg-surface3 hover:text-violet2 truncate">
                    📋 {t.name}
                  </button>
                  <button onClick={() => deleteTemplate(t.id)}
                    className="px-2 py-2 text-xs text-txt3 hover:text-danger opacity-0 group-hover:opacity-100 transition-all">✕</button>
                </div>
              ))}
            </div>
          )}

          {projects.map((p) => {
            const active = pathname === `/projects/${p.id}`;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} onClick={() => setOpen(false)}
                className={cn("flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors truncate",
                  active ? "" : "text-txt2 hover:bg-surface2 hover:text-txt")}
                style={active ? { backgroundColor: `${p.color || "#e05555"}20`, color: p.color || "#e05555" } : undefined}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color || "#e05555" }} />
                <span className="truncate">{p.title}</span>
              </Link>
            );
          })}

          <button onClick={handleNewProject}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-txt3 hover:bg-surface2 hover:text-txt w-full transition-colors">
            <span className="text-lg leading-none">＋</span><span>New Project</span>
            <kbd className="text-[9px] text-txt3 bg-surface3 px-1 py-0.5 rounded ml-auto">N</kbd>
          </button>
        </nav>

        <div className="p-3 border-t border-border text-[10px] text-txt3 px-5 space-y-0.5">
          <p><kbd className="bg-surface3 px-1 py-0.5 rounded">⌘K</kbd> Search · <kbd className="bg-surface3 px-1 py-0.5 rounded">D</kbd> Dashboard · <kbd className="bg-surface3 px-1 py-0.5 rounded">R</kbd> Routine · <kbd className="bg-surface3 px-1 py-0.5 rounded">W</kbd> Week · <kbd className="bg-surface3 px-1 py-0.5 rounded">N</kbd> New</p>
        </div>
        <div className="p-3 border-t border-border">
          <button onClick={handleSignOut}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-txt3 hover:bg-surface2 hover:text-danger transition-colors">Sign out</button>
        </div>
      </aside>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} userId={user.id}
        onComplete={() => { fetchProjects(); window.dispatchEvent(new Event("projects-changed")); }} />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
