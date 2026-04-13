"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { WeekTask, WeekDay, WeekTemplate, QuickTask } from "@/lib/types";
import { getMonday, addDays, formatDate, DAY_COLORS, DAY_NAMES_FULL, cn } from "@/lib/utils";
import { syncTaskCompletion } from "@/lib/sync";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { fetchWeekTasksGrouped, fetchWeekDayMeta, fetchWeekTemplates, fetchProjectsSlim, fetchProjectTasksSlim, fetchQuickTasks } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { CalendarDays, List } from "lucide-react";

const PRIORITY_COLORS: Record<number, string> = {
  1: "#4ade80", 2: "#34d399", 3: "#eab308", 4: "#f97316", 5: "#ef4444",
};

export default function WeekPage() {
  const router = useRouter();
  const { userId } = useCurrentUser();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"week" | "month" | "planner">("week");
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [tasks, setTasks] = useState<Record<string, WeekTask[]>>({});
  const [dayMeta, setDayMeta] = useState<Record<string, WeekDay>>({});
  const [templates, setTemplates] = useState<Record<number, string>>({});
  const [projects, setProjects] = useState<Array<{ id: string; title: string; color: string }>>([]);
  const [quickTasks, setQuickTasks] = useState<QuickTask[]>([]);
  const [now, setNow] = useState(new Date());
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [newTaskText, setNewTaskText] = useState("");
  const [editingTheme, setEditingTheme] = useState<string | null>(null);
  const [themeDraft, setThemeDraft] = useState("");
  const [linkProject, setLinkProject] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<"none" | "main" | "subtask">("none");
  const [linkParentTask, setLinkParentTask] = useState<string | null>(null);
  const [projectTasks, setProjectTasks] = useState<Array<{ id: string; name: string }>>([]);

  const [jumpPickerOpen, setJumpPickerOpen] = useState(false);

  const today = formatDate(new Date());

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();

      const dates: string[] = [];
      if (viewMode === "week" || viewMode === "planner") {
        for (let i = 0; i < 7; i++) dates.push(formatDate(addDays(weekStart, i)));
      } else {
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();
        const firstOfMonth = new Date(year, month, 1);
        const startPad = firstOfMonth.getDay() === 0 ? 6 : firstOfMonth.getDay() - 1;
        const startDate = addDays(firstOfMonth, -startPad);
        for (let i = 0; i < 42; i++) dates.push(formatDate(addDays(startDate, i)));
      }

      const [grouped, meta, tmpl, projs, qt] = await Promise.all([
        fetchWeekTasksGrouped(supabase, userId, dates),
        fetchWeekDayMeta(supabase, userId, dates),
        fetchWeekTemplates(supabase, userId),
        fetchProjectsSlim(supabase, userId),
        fetchQuickTasks(supabase, userId),
      ]);

      setTasks(grouped);
      setDayMeta(meta);
      setTemplates(tmpl);
      setProjects(projs);
      setQuickTasks(qt);
    } catch (err) {
      console.error("Week load failed:", err);
      toast("Failed to load planner", "error");
    }
  }, [weekStart, monthDate, viewMode, userId, toast]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(iv); }, []);

  // Map project titles to colors
  const projectColorMap: Record<string, string> = {};
  for (const p of projects) { projectColorMap[p.title] = p.color || "#e05555"; }

  // Map quick task names to priority colors
  const PRIORITY_TEXT_COLORS: Record<number, string> = {
    1: "#4ade80", 2: "#34d399", 3: "#eab308", 4: "#f97316", 5: "#ef4444",
  };
  const quickTaskColorMap: Record<string, string> = {};
  for (const qt of quickTasks) {
    quickTaskColorMap[qt.name] = PRIORITY_TEXT_COLORS[qt.priority] || "#eab308";
  }

  const getTagColor = (text: string): string | null => {
    const match = text.match(/^\[(.+?)\]/);
    if (!match) return null;
    return projectColorMap[match[1]] || "#7c6fff";
  };

  const getTaskColor = (t: WeekTask): string | null => {
    const tagColor = getTagColor(t.text);
    if (tagColor) return tagColor;
    // For non-project tasks, use quick task priority color
    return quickTaskColorMap[t.text] || null;
  };

  const toggleTaskDone = async (task: WeekTask) => {
    const supabase = createClient();
    const newDone = !task.done;

    // Optimistic UI update
    setTasks((prev) => {
      const copy = { ...prev };
      copy[task.date_key] = copy[task.date_key].map((t) => t.id === task.id ? { ...t, done: newDone } : t);
      return copy;
    });

    // Update week_task
    const { error } = await supabase.from("week_tasks").update({ done: newDone }).eq("id", task.id);
    if (error) {
      // Revert optimistic update
      setTasks((prev) => {
        const copy = { ...prev };
        copy[task.date_key] = copy[task.date_key].map((t) => t.id === task.id ? { ...t, done: !newDone } : t);
        return copy;
      });
      return;
    }

    // Sync to project if linked
    if (task.project_task_id) {
      const isSubtaskEntry = task.text.includes("↳");
      const newProgress = newDone ? 100 : 0;

      if (isSubtaskEntry) {
        // Subtask entry — update only that specific subtask, then recalc parent
        const subName = task.text.split("↳").pop()?.trim() || "";
        const { data: matchedSub } = await supabase
          .from("subtasks").select("id").eq("task_id", task.project_task_id)
          .ilike("name", subName).limit(1).maybeSingle();
        if (matchedSub) {
          await supabase.from("subtasks").update({ progress: newProgress }).eq("id", matchedSub.id);
        }
        const { data: allSubs } = await supabase
          .from("subtasks").select("progress").eq("task_id", task.project_task_id);
        if (allSubs && allSubs.length > 0) {
          const avg = Math.round(allSubs.reduce((s, st) => s + st.progress, 0) / allSubs.length);
          await supabase.from("project_tasks").update({ progress: avg }).eq("id", task.project_task_id);
          await syncTaskCompletion(supabase, userId, task.project_task_id, avg);
        }
      } else {
        // Main task entry
        const { data: subs } = await supabase
          .from("subtasks").select("id").eq("task_id", task.project_task_id).limit(1);

        if (!subs || subs.length === 0) {
          const { error: ptError } = await supabase.from("project_tasks")
            .update({ progress: newProgress })
            .eq("id", task.project_task_id);
          if (ptError) {
            toast("Failed to sync project progress", "error");
            await supabase.from("week_tasks").update({ done: !newDone }).eq("id", task.id);
            setTasks((prev) => {
              const copy = { ...prev };
              copy[task.date_key] = copy[task.date_key].map((t) => t.id === task.id ? { ...t, done: !newDone } : t);
              return copy;
            });
            return;
          }
        } else {
          await supabase.from("subtasks").update({ progress: newProgress }).eq("task_id", task.project_task_id);
          await supabase.from("project_tasks").update({ progress: newProgress }).eq("id", task.project_task_id);
        }
        await syncTaskCompletion(supabase, userId, task.project_task_id, newProgress);
      }
    }
    // If marking done and this came from a quick task, remove it from quick_tasks
    if (newDone && !task.project_task_id) {
      await supabase.from("quick_tasks").delete()
        .eq("user_id", userId).eq("name", task.text).eq("date_key", task.date_key);
    }
  };

  const addTask = async (dateKey: string) => {
    if (!newTaskText.trim()) return;
    const supabase = createClient();
    const existing = tasks[dateKey] || [];
    const text = newTaskText.trim();

    const proj = linkProject ? projects.find((p) => p.id === linkProject) : null;
    const taggedText = proj
      ? (linkType === "subtask" ? `[${proj.title}] ↳ ${text}` : `[${proj.title}] ${text}`)
      : text;

    let projectTaskId: string | null = null;

    if (proj && linkType === "main") {
      const { data: pt } = await supabase.from("project_tasks").insert({
        project_id: proj.id, user_id: userId, name: text,
        est_minutes: 0, deadline: dateKey, progress: 0,
        notes: "", elapsed_seconds: 0, sort_order: 999,
      }).select().single();
      if (pt) projectTaskId = pt.id;
    } else if (proj && linkType === "subtask" && linkParentTask) {
      const { data: sub } = await supabase.from("subtasks").insert({
        task_id: linkParentTask, user_id: userId, name: text,
        est_minutes: 0, deadline: dateKey, progress: 0,
        notes: "", sort_order: 999,
      }).select().single();
      if (sub) {
        projectTaskId = linkParentTask;
        // Recalc parent progress to include the new 0% subtask
        const { data: allSubs } = await supabase
          .from("subtasks").select("progress").eq("task_id", linkParentTask);
        if (allSubs && allSubs.length > 0) {
          const avg = Math.round(allSubs.reduce((s: number, st: { progress: number }) => s + st.progress, 0) / allSubs.length);
          await supabase.from("project_tasks").update({ progress: avg }).eq("id", linkParentTask);
        }
      }
    }

    const { data: newWeekTask } = await supabase.from("week_tasks").insert({
      user_id: userId, date_key: dateKey, text: taggedText,
      sort_order: existing.length,
      project_id: proj?.id || null,
      project_task_id: projectTaskId,
    }).select().single();

    if (newWeekTask) {
      setTasks((prev) => ({
        ...prev,
        [dateKey]: [...(prev[dateKey] || []), newWeekTask as WeekTask],
      }));
    }

    setNewTaskText("");
    setLinkProject(null);
    setLinkType("none");
    setLinkParentTask(null);
    setProjectTasks([]);
  };

  const loadProjectTasksForLink = async (projectId: string) => {
    const supabase = createClient();
    setProjectTasks(await fetchProjectTasksSlim(supabase, projectId));
  };

  const deleteTask = async (id: string) => {
    const supabase = createClient();
    await supabase.from("week_tasks").delete().eq("id", id);
    setTasks((prev) => {
      const copy: Record<string, WeekTask[]> = {};
      for (const [key, list] of Object.entries(prev)) {
        copy[key] = list.filter((t) => t.id !== id);
      }
      return copy;
    });
  };

  const saveTheme = async (dateKey: string, value: string) => {
    const supabase = createClient();
    const existing = dayMeta[dateKey];
    if (existing) {
      await supabase.from("week_days").update({ title: value }).eq("id", existing.id);
      setDayMeta((prev) => ({ ...prev, [dateKey]: { ...existing, title: value } }));
    } else {
      const { data } = await supabase.from("week_days").upsert(
        { user_id: userId, date_key: dateKey, title: value, notes: "" },
        { onConflict: "user_id,date_key" }
      ).select().single();
      if (data) setDayMeta((prev) => ({ ...prev, [dateKey]: data as WeekDay }));
    }
    setEditingTheme(null);
  };

  const prevWeek = () => setWeekStart(addDays(weekStart, -7));
  const nextWeek = () => setWeekStart(addDays(weekStart, 7));
  const goToday = () => { setWeekStart(getMonday(new Date())); setMonthDate(new Date()); };
  const prevMonth = () => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1));
  const nextMonth = () => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1));

  const jumpToDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    setWeekStart(getMonday(d));
    setMonthDate(d);
    setJumpPickerOpen(false);
  };

  // Stats
  const allTasks = Object.values(tasks).flat();
  const doneCount = allTasks.filter((t) => t.done).length;
  const totalCount = allTasks.length;

  // Per-project tag breakdown with colors
  const tagStats: Record<string, { done: number; total: number; color: string }> = {};
  for (const t of allTasks) {
    const match = t.text.match(/^\[(.+?)\]/);
    const tag = match ? match[1] : "Task list";
    const color = match ? (projectColorMap[match[1]] || "#7c6fff") : "#eab308";
    if (!tagStats[tag]) tagStats[tag] = { done: 0, total: 0, color };
    tagStats[tag].total++;
    if (t.done) tagStats[tag].done++;
  }

  const weekEndDate = addDays(weekStart, 6);
  const rangeLabel = viewMode === "week"
    ? `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : viewMode === "planner"
    ? `${quickTasks.length} tasks`
    : monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Month grid dates
  const monthGridDates: string[] = [];
  if (viewMode === "month") {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startPad = firstOfMonth.getDay() === 0 ? 6 : firstOfMonth.getDay() - 1;
    const startDate = addDays(firstOfMonth, -startPad);
    for (let i = 0; i < 42; i++) monthGridDates.push(formatDate(addDays(startDate, i)));
  }

  // Modal
  const modalDateObj = modalDate ? new Date(modalDate + "T00:00:00") : null;
  const modalDayNum = modalDateObj ? modalDateObj.getDay() : 0;
  const modalColor = modalDateObj ? DAY_COLORS[modalDayNum] : "#fff";
  const modalTasks = modalDate ? (tasks[modalDate] || []) : [];
  const modalTheme = modalDate ? (dayMeta[modalDate]?.title || templates[modalDayNum] || "") : "";
  const modalNotes = modalDate ? (dayMeta[modalDate]?.notes || "") : "";
  const modalDone = modalTasks.filter((t) => t.done).length;

  return (
    <div className="p-4 md:p-6 flex flex-col h-[calc(100vh-0px)]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="font-title text-2xl text-bright cursor-pointer hover:text-violet2 transition-colors"
            onClick={() => setViewMode("week")}>Planner</h1>
          <p className="text-sm text-txt2 mt-0.5">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setViewMode("week")}
              className={`px-3 py-1.5 text-xs transition-colors ${viewMode === "week" ? "bg-violet/15 text-violet2" : "text-txt3 hover:text-txt"}`}>
              Week
            </button>
            <button onClick={() => setViewMode("month")}
              className={`px-3 py-1.5 text-xs transition-colors ${viewMode === "month" ? "bg-violet/15 text-violet2" : "text-txt3 hover:text-txt"}`}>
              Month
            </button>
            <button onClick={() => setViewMode("planner")}
              className={`px-3 py-1.5 text-xs transition-colors flex items-center gap-1 ${viewMode === "planner" ? "bg-violet/15 text-violet2" : "text-txt3 hover:text-txt"}`}>
              <List size={12} /> List
            </button>
          </div>
          {viewMode !== "planner" && (
            <>
              <button onClick={viewMode === "week" ? prevWeek : prevMonth}
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm text-txt2 hover:text-txt hover:border-border2">‹</button>
              <div className="relative">
                <button onClick={goToday}
                  className="px-3 py-1.5 rounded-lg bg-violet/10 border border-violet/30 text-sm text-violet2 hover:bg-violet/20">Today</button>
                <button onClick={() => setJumpPickerOpen(!jumpPickerOpen)}
                  className="ml-1 px-2 py-1.5 rounded-lg bg-surface border border-border text-sm text-txt3 hover:text-txt hover:border-border2" title="Jump to date"><CalendarDays size={14} /></button>
                {jumpPickerOpen && (
                  <div className="absolute top-full mt-1 right-0 z-50 bg-surface2 border border-border rounded-lg shadow-xl p-2">
                    <input type="date" autoFocus
                      className="bg-surface border border-border rounded px-3 py-2 text-sm text-txt"
                      onChange={(e) => { if (e.target.value) jumpToDate(e.target.value); }} />
                  </div>
                )}
              </div>
              <button onClick={viewMode === "week" ? nextWeek : nextMonth}
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm text-txt2 hover:text-txt hover:border-border2">›</button>
            </>
          )}
        </div>
      </div>

      {/* Weekly stats */}
      {viewMode !== "planner" && (
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-txt3">Week:</span>
          <span className="text-bright font-mono">{doneCount}/{totalCount}</span>
          {totalCount > 0 && (
            <div className="w-32 h-2 bg-surface3 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-violet transition-all" style={{ width: `${(doneCount / totalCount) * 100}%` }} />
            </div>
          )}
          {totalCount > 0 && <span className="text-xs text-txt3">{Math.round((doneCount / totalCount) * 100)}%</span>}
        </div>
        {Object.keys(tagStats).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(tagStats).sort((a, b) => b[1].total - a[1].total).map(([tag, stats]) => {
              const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
              return (
                <div key={tag} className="flex items-center gap-1.5 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stats.color }} />
                  <span className="font-medium" style={{ color: stats.color }}>{tag}</span>
                  <span className="text-txt3 font-mono">{stats.done}/{stats.total}</span>
                  <div className="w-10 h-1 bg-surface3 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: stats.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Week view */}
      {viewMode === "week" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 flex-1 min-h-0">
          {Array.from({ length: 7 }, (_, i) => {
            const date = addDays(weekStart, i);
            const dateKey = formatDate(date);
            const dayNum = date.getDay();
            const color = DAY_COLORS[dayNum];
            const isToday = dateKey === today;
            const dayTasks = tasks[dateKey] || [];
            const doneTasks = dayTasks.filter((t) => t.done).length;
            const theme = dayMeta[dateKey]?.title || templates[dayNum] || "";
            const isEditingThis = editingTheme === dateKey;

            return (
              <div key={dateKey}
                className={cn("bg-surface border rounded-xl p-3 flex flex-col transition-all",
                  isToday ? "border-violet shadow-lg shadow-violet/10" : "border-border hover:border-border2")}>
                <div className="mb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider cursor-pointer" style={{ color }}
                      onClick={() => { setModalDate(dateKey); setNewTaskText(""); setLinkProject(null); setLinkType("none"); setLinkParentTask(null); setProjectTasks([]); }}>
                      {DAY_NAMES_FULL[dayNum].slice(0, 3)}
                    </span>
                    <span className="text-xs text-txt3">{date.getDate()}</span>
                  </div>
                  {isEditingThis ? (
                    <input value={themeDraft} onChange={(e) => setThemeDraft(e.target.value)}
                      onBlur={() => saveTheme(dateKey, themeDraft)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveTheme(dateKey, themeDraft); if (e.key === "Escape") setEditingTheme(null); }}
                      className="text-[10px] text-txt bg-surface3 border border-border rounded px-1 py-0.5 w-full mt-0.5 outline-none"
                      autoFocus />
                  ) : theme ? (
                    <p className="text-[11px] text-txt2 mt-0.5 truncate cursor-pointer hover:text-bright transition-colors"
                      onClick={(e) => { e.stopPropagation(); setEditingTheme(dateKey); setThemeDraft(theme); }}
                      title="Click to edit day name">
                      {theme}
                    </p>
                  ) : (
                    <button className="text-[10px] text-txt3 mt-0.5 px-1.5 py-0.5 border border-dashed border-border rounded hover:border-violet/50 hover:text-violet2 transition-colors"
                      onClick={(e) => { e.stopPropagation(); setEditingTheme(dateKey); setThemeDraft(""); }}
                      title="Name this day">
                      ＋ name
                    </button>
                  )}
                  {isToday && (
                    <p className="text-[10px] font-mono text-violet2 mt-0.5">
                      {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
                <div className="flex-1 space-y-1 overflow-y-auto min-h-0 cursor-pointer"
                  onClick={() => { setModalDate(dateKey); setNewTaskText(""); setLinkProject(null); setLinkType("none"); setLinkParentTask(null); setProjectTasks([]); }}>
                  {dayTasks.map((t) => {
                    const tagColor = getTagColor(t.text);
                    const taskColor = getTaskColor(t);
                    return (
                      <div key={t.id} className="flex items-start gap-1.5 text-xs group" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={t.done} onChange={() => toggleTaskDone(t)}
                          className="mt-0.5 w-3.5 h-3.5" style={{ accentColor: taskColor || color }} />
                        <span className={cn("leading-tight", t.done && "line-through text-txt3 opacity-60", t.project_id && "cursor-pointer hover:underline")}
                          onClick={() => { if (t.project_id) router.push(`/projects/${t.project_id}`); }}
                          style={!tagColor && taskColor && !t.done ? { color: taskColor } : undefined}>
                          {tagColor && <span className="font-medium" style={{ color: tagColor }}>{t.text.match(/^\[.*?\]/)?.[0]}{" "}</span>}
                          {t.text.replace(/^\[.*?\]\s*/, "")}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-end">
                  {dayTasks.length > 0 && <span className="text-[10px] text-txt3 font-mono">{doneTasks}/{dayTasks.length}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Month view */}
      {viewMode === "month" && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
              <div key={d} className="text-center text-[10px] text-txt3 uppercase tracking-wider py-1"
                style={{ color: DAY_COLORS[[1,2,3,4,5,6,0][i]] }}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 flex-1 min-h-0" style={{ gridTemplateRows: "repeat(6, minmax(60px, 1fr))" }}>
            {monthGridDates.map((dateKey) => {
              const date = new Date(dateKey + "T00:00:00");
              const dayNum = date.getDay();
              const isToday = dateKey === today;
              const isCurrentMonth = date.getMonth() === monthDate.getMonth();
              const dayTasks = tasks[dateKey] || [];
              const doneTasks = dayTasks.filter((t) => t.done).length;
              const theme = dayMeta[dateKey]?.title || "";

              return (
                <div key={dateKey}
                  onClick={() => { setModalDate(dateKey); setNewTaskText(""); setLinkProject(null); setLinkType("none"); setLinkParentTask(null); setProjectTasks([]); }}
                  className={cn(
                    "bg-surface border rounded-lg p-1.5 flex flex-col cursor-pointer transition-all overflow-hidden min-h-[60px]",
                    isToday ? "border-violet shadow-md shadow-violet/10" : "border-border/50 hover:border-border2",
                    !isCurrentMonth && "opacity-40"
                  )}>
                  <div className="flex items-center justify-between mb-0.5 shrink-0">
                    <span className={cn("text-[10px] font-bold", isToday ? "text-violet2" : "text-txt3")}
                      style={isCurrentMonth ? { color: DAY_COLORS[dayNum] } : undefined}>
                      {date.getDate()}
                    </span>
                    {dayTasks.length > 0 && (
                      <span className="text-[8px] text-txt3 font-mono">{doneTasks}/{dayTasks.length}</span>
                    )}
                  </div>
                  {theme && <p className="text-[8px] text-txt3 truncate shrink-0">{theme}</p>}
                  <div className="flex-1 space-y-0.5 overflow-hidden min-h-0">
                    {dayTasks.slice(0, 3).map((t) => {
                      const tagColor = getTagColor(t.text);
                      const taskColor = getTaskColor(t);
                      return (
                        <div key={t.id} className="flex items-center gap-1 text-[9px] leading-tight shrink-0" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={t.done} onChange={() => toggleTaskDone(t)}
                            className="w-2.5 h-2.5 shrink-0" style={{ accentColor: taskColor || DAY_COLORS[dayNum] }} />
                          <span className={cn("truncate", t.done && "line-through text-txt3 opacity-60")}
                            style={!tagColor && taskColor && !t.done ? { color: taskColor } : undefined}>{t.text.replace(/^\[.*?\]\s*/, "")}</span>
                        </div>
                      );
                    })}
                    {dayTasks.length > 3 && <p className="text-[8px] text-txt3 shrink-0">+{dayTasks.length - 3} more</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Planner view — Task List */}
      {viewMode === "planner" && (() => {
        const dated = quickTasks.filter((t) => t.date_key);
        const undated = quickTasks.filter((t) => !t.date_key);
        const grouped: Record<string, QuickTask[]> = {};
        for (const t of dated) {
          const k = t.date_key!;
          if (!grouped[k]) grouped[k] = [];
          grouped[k].push(t);
        }
        const sortedDates = Object.keys(grouped).sort();

        const completeQuickTask = async (id: string) => {
          if (!confirm("Task completed? This will remove it.")) return;
          const supabase = createClient();
          await supabase.from("quick_tasks").delete().eq("id", id);
          setQuickTasks((prev) => prev.filter((t) => t.id !== id));
          toast("Task completed!", "success");
        };

        return (
          <div className="flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-txt2">{quickTasks.length} tasks · {dated.length} scheduled</p>
              <a href="/tasks" className="text-xs text-violet2 hover:underline">Open full task list →</a>
            </div>

            {sortedDates.map((dateKey) => {
              const dayTasks = grouped[dateKey];
              const d = new Date(dateKey + "T00:00:00");
              const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
              const isToday = dateKey === today;
              const isPast = dateKey < today;
              return (
                <div key={dateKey} className="mb-4">
                  <h3 className={cn("text-xs font-medium mb-2 uppercase tracking-wider",
                    isToday ? "text-violet2" : isPast ? "text-danger" : "text-txt3")}>
                    {isToday ? "Today" : label} {isPast && !isToday && "· overdue"}
                  </h3>
                  <div className="space-y-1.5">
                    {dayTasks.map((t) => (
                      <div key={t.id} className="bg-surface border border-border rounded-lg px-3 py-2 flex items-center gap-3 group"
                        style={{ borderLeftWidth: 3, borderLeftColor: PRIORITY_COLORS[t.priority] || "#eab308" }}>
                        <button onClick={() => completeQuickTask(t.id)}
                          className="w-4 h-4 rounded border border-border hover:border-green-acc transition-colors shrink-0" />
                        <span className="text-sm flex-1" style={{ color: PRIORITY_COLORS[t.priority] || "#eab308" }}>{t.name}</span>
                        {t.notes && <span className="text-[10px] text-txt3 truncate max-w-[150px]">{t.notes}</span>}
                        <span className="text-[9px] font-mono text-txt3">{dateKey}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {undated.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-medium mb-2 uppercase tracking-wider text-txt3">Unscheduled</h3>
                <div className="space-y-1.5">
                  {undated.map((t) => (
                    <div key={t.id} className="bg-surface border border-border rounded-lg px-3 py-2 flex items-center gap-3 group"
                      style={{ borderLeftWidth: 3, borderLeftColor: PRIORITY_COLORS[t.priority] || "#eab308" }}>
                      <button onClick={() => completeQuickTask(t.id)}
                        className="w-4 h-4 rounded border border-border hover:border-green-acc transition-colors shrink-0" />
                      <span className="text-sm flex-1" style={{ color: PRIORITY_COLORS[t.priority] || "#eab308" }}>{t.name}</span>
                      {t.notes && <span className="text-[10px] text-txt3 truncate max-w-[150px]">{t.notes}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {quickTasks.length === 0 && (
              <div className="text-center py-16 text-txt3">
                <p className="text-lg font-medium text-txt2 mb-1">No quick tasks</p>
                <p className="text-sm">Add tasks in the <a href="/tasks" className="text-violet2 hover:underline">Task List</a></p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Day Detail Modal */}
      {modalDate && modalDateObj && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setModalDate(null); }}>
          <div className="bg-surface2 border border-border rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <div>
                <h2 className="font-title text-xl" style={{ color: modalColor }}>{DAY_NAMES_FULL[modalDayNum]}</h2>
                <p className="text-sm text-txt2 mt-0.5">
                  {modalDateObj.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  {modalTheme && <span className="text-txt3 ml-2">· {modalTheme}</span>}
                </p>
                {modalDate === today && (
                  <p className="text-xs font-mono text-violet2 mt-0.5">
                    {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setModalDate(null); router.push(`/week/${modalDate}`); }}
                  className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-txt2 hover:text-txt hover:border-border2">Full page ↗</button>
                <button onClick={() => setModalDate(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface3 text-txt3 hover:text-txt">✕</button>
              </div>
            </div>

            <div className="px-4 pt-3 flex items-center gap-3 text-sm">
              <span className="text-txt3">Completed:</span>
              <span className="text-bright font-mono">{modalDone}/{modalTasks.length}</span>
              {modalTasks.length > 0 && (
                <div className="flex-1 h-1.5 bg-surface3 rounded-full overflow-hidden max-w-xs">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(modalDone / modalTasks.length) * 100}%`, backgroundColor: modalColor }} />
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1.5 min-h-0">
              {modalTasks.length === 0 && <p className="text-sm text-txt3 text-center py-8">No tasks for this day</p>}
              {modalTasks.map((t) => {
                const tagColor = getTagColor(t.text);
                const taskColor = getTaskColor(t);
                return (
                  <div key={t.id} className={cn("flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-2.5 group", t.done && "opacity-60")}>
                    <input type="checkbox" checked={t.done} onChange={() => toggleTaskDone(t)}
                      className="w-4 h-4 shrink-0" style={{ accentColor: taskColor || modalColor }} />
                    <div className="flex-1 min-w-0">
                      <span className={cn("text-sm", t.done && "line-through text-txt3 opacity-60")}
                        style={!tagColor && taskColor && !t.done ? { color: taskColor } : undefined}>
                        {tagColor && (
                          <span className="font-medium text-xs px-1.5 py-0.5 rounded mr-1.5 cursor-pointer hover:underline"
                            style={{ color: tagColor, backgroundColor: `${tagColor}15` }}
                            onClick={() => { if (t.project_id) router.push(`/projects/${t.project_id}`); }}>
                            {t.text.match(/^\[(.+?)\]/)?.[1]}
                          </span>
                        )}
                        {t.text.replace(/^\[.*?\]\s*/, "")}
                      </span>
                    </div>
                    {t.project_id && (
                      <button onClick={() => router.push(`/projects/${t.project_id}`)}
                        className="text-txt3 hover:text-violet2 opacity-0 group-hover:opacity-100 transition-all text-xs shrink-0" title="Go to project">→</button>
                    )}
                    <button onClick={() => deleteTask(t.id)}
                      className="text-txt3 hover:text-danger opacity-0 group-hover:opacity-100 transition-all text-sm shrink-0">✕</button>
                  </div>
                );
              })}
            </div>

            <div className="p-4 border-t border-border shrink-0 space-y-3">
              {/* Step 1: Project link */}
              <div>
                <p className="text-[10px] text-txt3 uppercase tracking-wider mb-1.5">Link to project</p>
                <div className="flex flex-wrap gap-2">
                  <select value={linkProject || ""} onChange={(e) => {
                    const val = e.target.value || null;
                    setLinkProject(val);
                    setLinkType(val ? "none" : "none");
                    setLinkParentTask(null);
                    setProjectTasks([]);
                    if (val) loadProjectTasksForLink(val);
                  }}
                    className="bg-surface border border-border rounded-lg px-3 py-2 text-xs text-txt min-w-[140px]">
                    <option value="">— No project —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>● {p.title}</option>
                    ))}
                  </select>

                  {linkProject && (
                    <select value={linkType} onChange={(e) => {
                      const val = e.target.value as "none" | "main" | "subtask";
                      setLinkType(val);
                      setLinkParentTask(null);
                    }}
                      className="bg-surface border border-border rounded-lg px-3 py-2 text-xs text-txt">
                      <option value="none">Just tag it</option>
                      <option value="main">→ Create as main task</option>
                      {projectTasks.length > 0 && <option value="subtask">↳ Create as subtask of...</option>}
                    </select>
                  )}

                  {linkProject && linkType === "subtask" && projectTasks.length > 0 && (
                    <select value={linkParentTask || ""} onChange={(e) => setLinkParentTask(e.target.value || null)}
                      className="bg-surface border border-border rounded-lg px-3 py-2 text-xs text-txt flex-1 min-w-[140px]">
                      <option value="">— Pick parent task —</option>
                      {projectTasks.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Visual feedback of what will happen */}
                {linkProject && (
                  <p className="text-[10px] mt-1.5 px-1" style={{ color: projects.find(p => p.id === linkProject)?.color || "#7c6fff" }}>
                    {linkType === "none" && "→ Will add a tagged task to this day only"}
                    {linkType === "main" && "→ Will create a new main task in the project + add to this day"}
                    {linkType === "subtask" && !linkParentTask && "→ Select which main task to add the subtask under"}
                    {linkType === "subtask" && linkParentTask && `→ Will create a subtask under "${projectTasks.find(t => t.id === linkParentTask)?.name}" + add to this day`}
                  </p>
                )}
              </div>

              {/* Step 2: Task input */}
              <div className="flex gap-2">
                <input type="text" value={newTaskText} onChange={(e) => setNewTaskText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTask(modalDate)}
                  placeholder={linkProject ? "Task name..." : "Add a task..."}
                  className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder-txt3" autoFocus />
                <button onClick={() => addTask(modalDate)}
                  disabled={!newTaskText.trim() || (linkType === "subtask" && !linkParentTask)}
                  className="px-4 py-2 rounded-lg text-sm text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: modalColor }}>Add</button>
              </div>

              {modalNotes && (
                <div className="p-2 bg-surface rounded-lg">
                  <p className="text-[10px] text-txt3 uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-xs text-txt2 whitespace-pre-wrap">{modalNotes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
