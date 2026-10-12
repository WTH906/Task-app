"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { User } from "@supabase/supabase-js";
import { Project, Template } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ImportModal } from "./ImportModal";
import { SearchModal } from "./SearchModal";
import { WorkClock } from "./WorkClock";
import { ActiveTimerBadge } from "./ActiveTimerBadge";
import { useToast } from "./Toast";
import { useLocale, type MessageKey } from "@/lib/i18n/useLocale";
import { fetchProjects as fetchProjectsQuery, fetchTemplates as fetchTemplatesQuery } from "@/lib/queries";
import { reorderRows } from "@/lib/db-helpers";
import { useSettings } from "@/lib/hooks/useSettings";
import {
  LayoutDashboard, ListChecks, RefreshCw, CalendarDays, ClipboardList,
  Map, BarChart3, Timer, Search, Download, ClipboardCopy, FolderPlus,
  ChevronDown, LogOut, Menu, X, CalendarRange, User as UserIcon, PieChart,
  BookUser, Palette, Clock, SlidersHorizontal, BookOpen,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";

/** localStorage key — also read by the pre-paint script in app/layout.tsx. */
const COLLAPSE_KEY = "comfy-sidebar-collapsed";
const TOOLS_KEY = "comfy-tools-open";

/**
 * Push the collapsed state onto <html>.
 *
 * `--sidebar-w` is what the content pane indents by (see .app-main in
 * globals.css). Driving the layout from a CSS variable rather than React
 * state means AppShell doesn't have to thread a prop down into every page,
 * and the pre-paint script in layout.tsx can set the same value before
 * hydration so the content doesn't jump sideways on load.
 */
function applyCollapsed(collapsed: boolean) {
  const root = document.documentElement;
  root.style.setProperty("--sidebar-w", collapsed ? "0rem" : "15rem");
  root.setAttribute("data-sidebar", collapsed ? "collapsed" : "expanded");
}

export function Sidebar({ user }: { user: User }) {
  const { has } = useSettings();
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [dragProjectIdx, setDragProjectIdx] = useState<number | null>(null);
  const [projectSort, setProjectSort] = useState<"custom" | "alpha" | "deadline">("custom");
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  // `open`     — the mobile drawer (overlay).
  // `collapsed` — the desktop panel, Obsidian-style: hidden entirely, with the
  //               content pane reclaiming the space. Persisted, so it survives
  //               reloads and navigation.
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { toast } = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);

  const THEMES = [
    { id: "purple", label: "Purple", dot: "#9217BF" },
    { id: "ocean", label: "Ocean", dot: "#43B8FA" },
    { id: "emerald", label: "Emerald", dot: "#34d399" },
    { id: "ember", label: "Ember", dot: "#f0a050" },
    { id: "frost", label: "Frost ☀", dot: "#2563eb" },
    { id: "cloud", label: "Cloud ☀", dot: "#7c3aed" },
  ] as const;

  const [theme, setTheme] = useState("purple");

  // Init theme from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("comfy-theme") || "purple";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved === "purple" ? "" : saved);
    if (saved === "dawn" || saved === "frost") {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const cycleTheme = () => {
    const idx = THEMES.findIndex(t => t.id === theme);
    const next = THEMES[(idx + 1) % THEMES.length];
    setTheme(next.id);
    localStorage.setItem("comfy-theme", next.id);
    document.documentElement.setAttribute("data-theme", next.id === "purple" ? "" : next.id);
    // Toggle light/dark mode
    const isLight = next.id === "frost" || next.id === "cloud";
    if (isLight) {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "light";
    } else {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    }
  };

  // Let other surfaces (e.g. the dashboard's empty state) open the
  // new-project dialog, which lives here.
  useEffect(() => {
    const handler = () => { setNewProjectName(""); setNewProjectOpen(true); };
    window.addEventListener("new-project", handler);
    return () => window.removeEventListener("new-project", handler);
  }, []);

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = () => setUserMenuOpen(false);
    setTimeout(() => document.addEventListener("click", handler), 0);
    return () => document.removeEventListener("click", handler);
  }, [userMenuOpen]);

  const fetchProjects = useCallback(async () => {
    const supabase = createClient();
    setProjects(await fetchProjectsQuery(supabase, user.id));
  }, [user.id]);

  const fetchTemplates = useCallback(async () => {
    const supabase = createClient();
    setTemplates(await fetchTemplatesQuery(supabase, user.id));
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

  // Read feature state through a ref inside the key handler so the listener
  // isn't torn down and re-added every time a toggle changes.
  const hasRef = useRef(has);
  useEffect(() => { hasRef.current = has; }, [has]);

  // The committed collapsed state, readable synchronously from callbacks.
  // Used so `toggleCollapsed` can compute the next value without doing side
  // effects inside a setState updater — React may call an updater more than
  // once, which would write localStorage twice and could apply a CSS variable
  // derived from a value that never commits.
  const collapsedRef = useRef(false);

  // Adopt whatever the pre-paint script already applied, so React's idea of
  // the state matches what's on screen. Read here rather than in useState's
  // initialiser: localStorage doesn't exist during SSR, and a server render
  // that disagreed with the client would be a hydration error.
  useEffect(() => {
    let saved = false;
    try { saved = localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { /* storage blocked */ }
    collapsedRef.current = saved;
    setCollapsed(saved);
    applyCollapsed(saved);
  }, []);

  useEffect(() => {
    try { if (localStorage.getItem(TOOLS_KEY) === "0") setToolsOpen(false); } catch {}
  }, []);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsedRef.current;
    collapsedRef.current = next;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* storage blocked */ }
    applyCollapsed(next);

    // Keep focus somewhere visible. Collapsing while the close button has
    // focus would otherwise leave the caret inside a panel that is now off
    // screen, so the next Tab continues from a control nobody can see.
    requestAnimationFrame(() => {
      const target = document.getElementById(next ? "sidebar-reveal" : "sidebar-hide");
      target?.focus();
    });
  }, []);

  // Keep multiple tabs in step. Without this, collapsing in one tab and then
  // pressing the shortcut in another writes the inverse value back and both
  // end up wrong.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== COLLAPSE_KEY) return;
      const next = e.newValue === "1";
      collapsedRef.current = next;
      setCollapsed(next);
      applyCollapsed(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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

      // Ctrl/Cmd+B toggles the left panel — the binding VS Code and Obsidian
      // both use.
      //
      // Below the `isInput` guard on purpose: Ctrl+B means bold in a text
      // field, and hijacking it while someone is typing a project name is
      // worse than not having the shortcut there. `!e.shiftKey` leaves
      // Ctrl+Shift+B (the browser's bookmarks bar) alone.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleCollapsed();
        return;
      }

      // Quick nav shortcuts
      // "a" is quick capture (handled in QuickCapture) — don't bind it here.
      if (e.key === "d") { e.preventDefault(); router.push("/"); }
      if (e.key === "r" && hasRef.current("dailyRoutine")) { e.preventDefault(); router.push("/routine"); }
      if (e.key === "e" && hasRef.current("weeklyRoutine")) { e.preventDefault(); router.push("/weekly-routine"); }
      if (e.key === "w" && hasRef.current("planner")) { e.preventDefault(); router.push("/week"); }
      if (e.key === "q" && hasRef.current("taskList")) { e.preventDefault(); router.push("/tasks"); }
      if (e.key === "m" && hasRef.current("roadmap")) { e.preventDefault(); router.push("/roadmap"); }
      if (e.key === "t" && hasRef.current("retro")) { e.preventDefault(); router.push("/retro"); }
      if (e.key === "l" && hasRef.current("deadlines")) { e.preventDefault(); router.push("/deadlines"); }
      if (e.key === "n") { e.preventDefault(); handleNewProject(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [router, toggleCollapsed]);

  // Nav is driven by the feature toggles now, not localStorage flags — so it
  // follows the user between browsers and can't drift from what /settings says.
  const navItems: Array<{ href: string; icon: React.ReactNode; label: string; accent: string; key: string }> = [
    { href: "/", icon: <LayoutDashboard size={18} />, label: t("nav.dashboard"), accent: "violet", key: "D" },
    ...(has("dailyRoutine") ? [{ href: "/routine", icon: <ListChecks size={18} />, label: t("nav.dailyRoutine"), accent: "red-acc", key: "R" }] : []),
    ...(has("weeklyRoutine") ? [{ href: "/weekly-routine", icon: <RefreshCw size={18} />, label: t("nav.weeklyRoutine"), accent: "violet", key: "E" }] : []),
    ...(has("monthlyRoutine") ? [{ href: "/monthly-routine", icon: <CalendarRange size={18} />, label: t("nav.monthlyRoutine"), accent: "violet", key: "Y" }] : []),
    ...(has("yearlyRoutine") ? [{ href: "/yearly-routine", icon: <CalendarRange size={18} />, label: t("nav.yearlyRoutine"), accent: "violet", key: "" }] : []),
    ...(has("planner") ? [{ href: "/week", icon: <CalendarDays size={18} />, label: t("nav.calendar"), accent: "violet", key: "W" }] : []),
    ...(has("taskList") ? [{ href: "/tasks", icon: <ClipboardList size={18} />, label: t("nav.taskList"), accent: "violet", key: "Q" }] : []),
    ...(has("roadmap") ? [{ href: "/roadmap", icon: <Map size={18} />, label: t("nav.roadmap"), accent: "violet", key: "M" }] : []),
    ...(has("retro") ? [{ href: "/retro", icon: <BarChart3 size={18} />, label: t("nav.retroPlanning"), accent: "violet", key: "T" }] : []),
    ...(has("deadlines") ? [{ href: "/deadlines", icon: <Timer size={18} />, label: t("nav.deadlines"), accent: "violet", key: "L" }] : []),
    ...(has("stats") ? [{ href: "/stats", icon: <PieChart size={18} />, label: t("nav.stats"), accent: "violet", key: "" }] : []),
  ];

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleNewProject = () => {
    setNewProjectName("");
    setNewProjectOpen(true);
  };

  const createProject = async (title: string) => {
    if (!title.trim()) return;
    const supabase = createClient();
    const { data } = await supabase.from("projects")
      .insert({ user_id: user.id, title: title.trim(), sort_order: projects.length })
      .select().single();
    if (data) { window.dispatchEvent(new Event("projects-changed")); router.push(`/projects/${data.id}`); }
    setNewProjectOpen(false);
  };

  const createFromTemplate = async (template: Template) => {
    setNewProjectName(template.name);
    setNewProjectOpen(true);
    // Store template for use after modal submit
    pendingTemplateRef.current = template;
  };

  const pendingTemplateRef = useRef<Template | null>(null);

  const handleProjectModalSubmit = async () => {
    const title = newProjectName.trim();
    if (!title) return;
    const template = pendingTemplateRef.current;
    pendingTemplateRef.current = null;
    setNewProjectOpen(false);

    if (!template) {
      await createProject(title);
      return;
    }

    // Create from template
    const supabase = createClient();
    const { data: proj } = await supabase.from("projects")
      .insert({ user_id: user.id, title, sort_order: projects.length })
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
    if (!confirm(t("templates.deleteConfirm"))) return;
    const supabase = createClient();
    await supabase.from("templates").delete().eq("id", id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const moveProject = async (idx: number, direction: number) => {
    if (projectSort !== "custom") return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= projects.length) return;
    const newProjects = [...projects];
    [newProjects[idx], newProjects[newIdx]] = [newProjects[newIdx], newProjects[idx]];
    setProjects(newProjects);
    const supabase = createClient();
    await reorderRows(supabase, "projects", newProjects.map((proj) => proj.id), user?.id ?? "");
  };

  return (
    <>
      <button onClick={() => setOpen(!open)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="fixed top-3 left-3 z-50 md:hidden w-10 h-10 flex items-center justify-center bg-surface2 rounded-lg border border-border">
        <span className="text-lg" aria-hidden="true">{open ? <X size={20} /> : <Menu size={20} />}</span>
      </button>
      {open && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setOpen(false)} />}

      {/*
        The only way back once the panel is hidden. Deliberately small and in
        the corner the panel left from, so it reads as an edge handle rather
        than a floating control.
      */}
      {collapsed && (
        <button type="button" id="sidebar-reveal" onClick={toggleCollapsed}
          title="Show sidebar (Ctrl/⌘ B)"
          aria-label="Show sidebar"
          aria-expanded={false}
          className="hidden md:flex fixed top-3 left-3 z-50 w-9 h-9 items-center justify-center rounded-lg bg-surface2/80 border border-border text-txt3 hover:text-txt hover:border-border2 backdrop-blur-sm transition-colors">
          <PanelLeftOpen size={17} />
        </button>
      )}

      {/*
        A collapsed panel is only translated off screen, so without help every
        control inside it — search, each nav link, each project, Sign out —
        stays in the tab order and a keyboard user tabs through ~30 invisible
        buttons before reaching the page.

        That is handled in CSS (`visibility: hidden` on the collapsed panel,
        see globals.css), NOT with React's `inert` prop. This project is on
        React 18, which doesn't know `inert`: it drops the attribute entirely
        — so the fix silently wouldn't work — and logs a "Received `false` for
        a non-boolean attribute" warning on every render, which Next's dev
        overlay then reports as an error. `visibility` does the same job
        natively and doesn't care which React version is underneath.
      */}
      <aside aria-label="Sidebar" className={cn(
        "fixed top-0 left-0 h-full w-60 bg-surface border-r border-border z-40 flex flex-col transition-transform duration-200 motion-reduce:transition-none",
        !open && "-translate-x-full md:translate-x-0",
        // Desktop collapse reuses the same slide the mobile drawer already
        // uses. Keeping the panel at its natural width and moving it out of
        // view — rather than animating the width to zero — means nothing
        // inside has to reflow, so there's no text-squashing on the way out.
        collapsed && "md:-translate-x-full"
      )}>
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <h2 className="font-title text-lg text-bright tracking-wide flex-1 truncate">Comfy Board</h2>
            <button type="button" id="sidebar-hide" onClick={toggleCollapsed}
              title="Hide sidebar (Ctrl/⌘ B)"
              aria-label="Hide sidebar"
              aria-expanded={true}
              className="hidden md:flex w-7 h-7 items-center justify-center rounded-lg text-txt3 hover:text-txt hover:bg-surface2 transition-colors shrink-0">
              <PanelLeftClose size={16} />
            </button>
          </div>
          <div className="relative mt-1">
            <button onClick={() => setUserMenuOpen(!userMenuOpen)}
              aria-expanded={userMenuOpen}
              aria-label="User menu"
              className="flex items-center gap-2 text-xs text-txt3 hover:text-txt transition-colors w-full">
              <UserIcon size={13} />
              <span className="truncate flex-1 text-left">{user.email}</span>
              <ChevronDown size={12} className={cn("transition-transform", userMenuOpen && "rotate-180")} />
            </button>
            {userMenuOpen && (
              <div className="absolute left-0 top-full mt-1 bg-surface2 border border-border rounded-lg shadow-xl py-1 w-full z-50">
                <Link href="/stats" onClick={() => { setUserMenuOpen(false); setOpen(false); }}
                  className="flex items-center gap-2 px-3 py-2 text-xs text-txt2 hover:bg-surface3 transition-colors w-full">
                  <PieChart size={13} /> {t("nav.stats")}
                </Link>
                <div className="border-t border-border my-1" />
                <div className="px-3 py-1">
                  <span className="text-[10px] text-txt3 uppercase tracking-wider">{t("nav.theme")}</span>
                </div>
                {THEMES.map(thm => (
                  <button key={thm.id} onClick={(e) => {
                    e.stopPropagation();
                    setTheme(thm.id);
                    localStorage.setItem("comfy-theme", thm.id);
                    document.documentElement.setAttribute("data-theme", thm.id === "purple" ? "" : thm.id);
                    const isLight = thm.id === "frost" || thm.id === "cloud";
                    if (isLight) {
                      document.documentElement.classList.remove("dark");
                      document.documentElement.style.colorScheme = "light";
                    } else {
                      document.documentElement.classList.add("dark");
                      document.documentElement.style.colorScheme = "dark";
                    }
                  }}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-txt2 hover:bg-surface3 transition-colors w-full">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: thm.dot }} />
                    <span className="flex-1 text-left">{t(`theme.${thm.id}` as MessageKey)}{(thm.id === "frost" || thm.id === "cloud") ? " ☀" : ""}</span>
                    {theme === thm.id && <span className="text-[10px] text-violet2">✓</span>}
                  </button>
                ))}
                <div className="border-t border-border my-1" />
                <button onClick={handleSignOut}
                  className="flex items-center gap-2 px-3 py-2 text-xs text-txt3 hover:text-danger hover:bg-surface3 transition-colors w-full">
                  <LogOut size={13} /> {t("nav.signOut")}
                </button>
              </div>
            )}
          </div>
        </div>

        <button onClick={() => setSearchOpen(true)}
          className="mx-2 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface2 border border-border text-sm text-txt3 hover:text-txt hover:border-border2 transition-colors">
          <span><Search size={14} /></span><span className="flex-1 text-left">{t("common.search")}</span>
          <kbd className="text-[9px] bg-surface3 px-1 py-0.5 rounded">⌘K</kbd>
        </button>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-2 space-y-1 mt-1">
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" : (pathname === item.href || pathname.startsWith(item.href + "/"));
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  active ? "" : "text-txt2 hover:bg-surface2 hover:text-txt")}
                style={active ? {
                  backgroundColor: "color-mix(in srgb, var(--accent) 15%, transparent)",
                  color: "var(--accent2)",
                } : undefined}>
                <span className="w-5 h-5 flex items-center justify-center shrink-0">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.key && <kbd className="text-[9px] text-txt3 bg-surface3 px-1 py-0.5 rounded">{item.key}</kbd>}
              </Link>
            );
          })}

          <div className="border-t border-border my-3" />

          <div className="px-3 mb-1 flex items-center justify-between">
            <Link href="/projects" onClick={() => setOpen(false)}
              className="text-[11px] uppercase tracking-wider text-txt3 hover:text-red-acc transition-colors">{t("nav.projects")}</Link>
            <div className="flex items-center gap-1">
              <button onClick={() => setProjectSort(s => s === "custom" ? "alpha" : s === "alpha" ? "deadline" : "custom")}
                title={`Sort: ${projectSort}`}
                aria-label={`Sort projects: ${projectSort}`}
                className="text-[9px] text-txt3 hover:text-txt transition-colors px-1.5 py-1 rounded bg-surface3 min-w-[24px] min-h-[24px] flex items-center justify-center">
                <span aria-hidden="true">{projectSort === "custom" ? "⠿" : projectSort === "alpha" ? "AZ" : "📅"}</span>
              </button>
              <button type="button" onClick={() => setImportOpen(true)} title={t("projects.import")} aria-label={t("projects.import")} className="text-txt3 hover:text-green-acc transition-colors p-1 min-w-[24px] min-h-[24px] flex items-center justify-center"><Download size={14} /></button>
              <button type="button" onClick={() => { fetchTemplates(); setTemplateOpen(!templateOpen); }} title={t("projects.templates")} aria-expanded={templateOpen} aria-label={t("projects.templates")} className="text-txt3 hover:text-violet2 transition-colors p-1 min-w-[24px] min-h-[24px] flex items-center justify-center"><ClipboardCopy size={14} /></button>
            </div>
          </div>

          {templateOpen && (
            <div className="mx-2 mb-2 bg-surface2 border border-border rounded-lg overflow-hidden">
              {templates.length === 0 ? (
                <p className="text-[11px] text-txt3 px-3 py-2 text-center">{t("templates.noTemplates")}</p>
              ) : templates.map((t) => (
                <div key={t.id} className="flex items-center border-b border-border/50 last:border-b-0 group">
                  <button onClick={() => createFromTemplate(t)}
                    className="flex-1 text-left px-3 py-2 text-xs text-txt2 hover:bg-surface3 hover:text-violet2 truncate">
                    <ClipboardCopy size={12} className="shrink-0" /> {t.name}
                  </button>
                  <button type="button" onClick={() => deleteTemplate(t.id)} aria-label="Delete template"
                    className="px-2 py-2 text-xs text-txt3 hover:text-danger opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all">✕</button>
                </div>
              ))}
            </div>
          )}

          {(() => {
            const sorted = projectSort === "alpha"
              ? [...projects].sort((a, b) => a.title.localeCompare(b.title))
              : projectSort === "deadline"
              ? [...projects].sort((a, b) => {
                  if (!a.deadline && !b.deadline) return 0;
                  if (!a.deadline) return 1;
                  if (!b.deadline) return -1;
                  return a.deadline.localeCompare(b.deadline);
                })
              : projects;
            return sorted.map((p, idx) => {
            const active = pathname === `/projects/${p.id}`;
            return (
              <div key={p.id} className="flex items-center group/proj">
                <button type="button"
                  draggable
                  onClick={() => { router.push(`/projects/${p.id}`); setOpen(false); }}
                  onDragStart={() => setDragProjectIdx(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    // Check if it's a task being dragged (from project page)
                    if (e.dataTransfer.types.includes("task-id")) {
                      setDropTargetId(p.id);
                      e.dataTransfer.dropEffect = "move";
                      return;
                    }
                    // Otherwise it's project reorder
                    if (dragProjectIdx !== null && dragProjectIdx !== idx) {
                      setProjects(prev => {
                        const copy = [...prev];
                        const [item] = copy.splice(dragProjectIdx, 1);
                        copy.splice(idx, 0, item);
                        return copy;
                      });
                      setDragProjectIdx(idx);
                    }
                  }}
                  onDragLeave={() => setDropTargetId(null)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setDropTargetId(null);
                    const taskId = e.dataTransfer.getData("task-id");
                    const taskName = e.dataTransfer.getData("task-name");
                    if (taskId && taskId.length > 10) {
                      // Move task to this project
                      const supabase = createClient();
                      await supabase.from("project_tasks").update({ project_id: p.id }).eq("id", taskId);

                      // Re-point the mirrored planner rows. Since migration v21
                      // the project is carried by project_id alone, so this is a
                      // single UPDATE — no text rewriting, and nothing can drift.
                      await supabase.from("week_tasks")
                        .update({ project_id: p.id })
                        .eq("project_task_id", taskId).eq("user_id", user?.id ?? "");

                      window.dispatchEvent(new CustomEvent("task-moved", { detail: { taskId, targetProject: p.title } }));
                      toast(`"${taskName}" moved to ${p.title}`, "success");
                    }
                  }}
                  onDragEnd={async () => {
                    setDragProjectIdx(null);
                    setDropTargetId(null);
                    const supabase = createClient();
                    // One RPC instead of N un-awaited updates (which never ran).
                    const { error } = await reorderRows(
                      supabase, "projects", projects.map((proj) => proj.id), user?.id ?? ""
                    );
                    if (error) toast("Failed to save order: " + error, "error");
                  }}
                  className={cn("flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors truncate cursor-grab select-none text-left",
                    active ? "" : "text-txt2 hover:bg-surface2 hover:text-txt",
                    dropTargetId === p.id && "ring-2 ring-violet")}
                  style={active ? { backgroundColor: `${p.color || "#e05555"}20`, color: p.color || "#e05555" } : undefined}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color || "#e05555" }} />
                  <span className="truncate">{p.title}</span>
                </button>
                {projectSort === "custom" && (
                  <div className="flex flex-col shrink-0 opacity-0 group-hover/proj:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button type="button" aria-label="Move up" disabled={idx === 0}
                      onClick={() => { moveProject(idx, -1).catch(() => {}); }}
                      className="p-0.5 min-w-[20px] min-h-[16px] flex items-center justify-center text-txt3 hover:text-violet2 disabled:opacity-30 transition-colors rounded">
                      <span aria-hidden="true" className="text-[9px]">▲</span>
                    </button>
                    <button type="button" aria-label="Move down" disabled={idx === sorted.length - 1}
                      onClick={() => { moveProject(idx, 1).catch(() => {}); }}
                      className="p-0.5 min-w-[20px] min-h-[16px] flex items-center justify-center text-txt3 hover:text-violet2 disabled:opacity-30 transition-colors rounded">
                      <span aria-hidden="true" className="text-[9px]">▼</span>
                    </button>
                  </div>
                )}
              </div>
            );
          });
          })()}

          <button onClick={handleNewProject}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-txt3 hover:bg-surface2 hover:text-txt w-full transition-colors">
            <FolderPlus size={16} className="shrink-0" /><span>{t("nav.newProject")}</span>
            <kbd className="text-[9px] text-txt3 bg-surface3 px-1 py-0.5 rounded ml-auto">N</kbd>
          </button>
        </nav>

        <div className="border-t border-border">
          <button onClick={() => {
            setToolsOpen(prev => {
              const next = !prev;
              try { localStorage.setItem(TOOLS_KEY, next ? "1" : "0"); } catch {}
              return next;
            });
          }}
            aria-expanded={toolsOpen}
            className="flex items-center w-full px-3 py-2 text-[11px] uppercase tracking-wider text-txt3 hover:text-txt transition-colors">
            <ChevronDown size={12} className={cn("transition-transform mr-1.5", !toolsOpen && "-rotate-90")} />
            {t("nav.tools")}
          </button>
          {toolsOpen && (
            <div className="px-3 pb-3 space-y-1">
              <ActiveTimerBadge userId={user.id} />
              <WorkClock userId={user.id} alwaysShow={has("workClock")} />

              {has("contacts") && (
                <button onClick={() => window.dispatchEvent(new Event("toggle-contacts"))}
                  className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-txt3 hover:bg-surface2 hover:text-txt transition-colors">
                  <BookUser size={15} /> <span>{t("nav.contacts")}</span>
                  <span className="ml-auto text-[9px] text-txt3" aria-hidden>→</span>
                </button>
              )}

              {has("monitoring") && (
                <button onClick={() => window.dispatchEvent(new Event("toggle-monitoring"))}
                  className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-txt3 hover:bg-surface2 hover:text-amber transition-colors">
                  <Clock size={15} /> <span>{t("nav.monitoring")}</span>
                  <span className="ml-auto text-[9px] text-txt3" aria-hidden>←</span>
                </button>
              )}

              <Link href="/guide"
                className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-txt3 hover:bg-surface2 hover:text-txt transition-colors">
                <BookOpen size={15} /> <span>{t("nav.guide")}</span>
              </Link>

              <Link href="/settings"
                className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs text-txt3 hover:bg-surface2 hover:text-txt transition-colors">
                <SlidersHorizontal size={15} /> <span>{t("nav.settings")}</span>
              </Link>

              <div className="text-[10px] text-txt3 px-2 space-y-0.5">
                <p>
                  <kbd className="bg-surface3 px-1 py-0.5 rounded">A</kbd> {t("shortcut.capture")} ·{" "}
                  <kbd className="bg-surface3 px-1 py-0.5 rounded">⌘K</kbd> {t("shortcut.search")} ·{" "}
                  <kbd className="bg-surface3 px-1 py-0.5 rounded">D</kbd> {t("shortcut.home")} ·{" "}
                  <kbd className="bg-surface3 px-1 py-0.5 rounded">W</kbd> {t("shortcut.calendar")} ·{" "}
                  <kbd className="bg-surface3 px-1 py-0.5 rounded">N</kbd> {t("shortcut.new")} ·{" "}
                  <kbd className="bg-surface3 px-1 py-0.5 rounded">⌘B</kbd> {t("shortcut.panel")}
                </p>
              </div>
            </div>
          )}
        </div>
      </aside>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} userId={user.id}
        onComplete={() => { fetchProjects(); window.dispatchEvent(new Event("projects-changed")); }} />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* New Project Modal */}
      {newProjectOpen && (
        <>
          <div className="fixed inset-0 z-[199]" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
            onClick={() => { setNewProjectOpen(false); pendingTemplateRef.current = null; }} />
          <div className="fixed z-[200] w-[90vw] max-w-sm rounded-2xl p-6"
            style={{
              top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              background: "color-mix(in srgb, var(--surface) 95%, transparent)",
              border: "1px solid var(--border)",
              boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
            }}>
            <h2 className="text-lg font-semibold text-bright mb-4">{t("nav.newProject")}</h2>
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleProjectModalSubmit(); if (e.key === "Escape") { setNewProjectOpen(false); pendingTemplateRef.current = null; } }}
              placeholder="Project name"
              className="w-full bg-surface2 border border-border rounded-lg px-4 py-3 text-txt text-sm mb-4 focus:outline-none focus:border-violet"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setNewProjectOpen(false); pendingTemplateRef.current = null; }}
                className="px-4 py-2 text-sm text-txt3 hover:text-txt transition-colors">{t("common.cancel")}</button>
              <button onClick={handleProjectModalSubmit} disabled={!newProjectName.trim()}
                className="px-4 py-2 text-sm bg-violet text-on-accent rounded-lg hover:opacity-90 disabled:opacity-40 transition-colors">{t("common.create")}</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
