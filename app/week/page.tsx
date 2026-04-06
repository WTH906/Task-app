"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { WeekTask, WeekDay, WeekTemplate } from "@/lib/types";
import { getMonday, addDays, formatDate, DAY_COLORS, DAY_NAMES_FULL, cn, toLocalDateStr } from "@/lib/utils";
import { syncWeekDoneToProject } from "@/lib/sync";

export default function WeekPage() {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [tasks, setTasks] = useState<Record<string, WeekTask[]>>({});
  const [dayMeta, setDayMeta] = useState<Record<string, WeekDay>>({});
  const [templates, setTemplates] = useState<Record<number, string>>({});
  const [projects, setProjects] = useState<Array<{ id: string; title: string; color: string }>>([]);
  const [now, setNow] = useState(new Date());
  const [userId, setUserId] = useState("");
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [newTaskText, setNewTaskText] = useState("");
  const [editingTheme, setEditingTheme] = useState<string | null>(null);
  const [themeDraft, setThemeDraft] = useState("");
  const [linkProject, setLinkProject] = useState<string | null>(null); // project id
  const [linkType, setLinkType] = useState<"none" | "main" | "subtask">("none");
  const [linkParentTask, setLinkParentTask] = useState<string | null>(null);
  const [projectTasks, setProjectTasks] = useState<Array<{ id: string; name: string }>>([]);

  const today = toLocalDateStr(new Date());

  const loadWeek = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const dates: string[] = [];
    for (let i = 0; i < 7; i++) dates.push(formatDate(addDays(weekStart, i)));

    const { data: weekTasks } = await supabase.from("week_tasks").select("*").eq("user_id", user.id).in("date_key", dates).order("sort_order");
    const grouped: Record<string, WeekTask[]> = {};
    dates.forEach((d) => (grouped[d] = []));
    (weekTasks || []).forEach((t: WeekTask) => { if (!grouped[t.date_key]) grouped[t.date_key] = []; grouped[t.date_key].push(t); });
    setTasks(grouped);

    const { data: days } = await supabase.from("week_days").select("*").eq("user_id", user.id).in("date_key", dates);
    const meta: Record<string, WeekDay> = {};
    (days || []).forEach((d: WeekDay) => (meta[d.date_key] = d));
    setDayMeta(meta);

    const { data: tmpl } = await supabase.from("week_templates").select("*").eq("user_id", user.id);
    const t: Record<number, string> = {};
    (tmpl || []).forEach((wt: WeekTemplate) => (t[wt.weekday] = wt.title));
    setTemplates(t);

    const { data: projs } = await supabase.from("projects").select("id, title, color").eq("user_id", user.id);
    setProjects((projs || []) as Array<{ id: string; title: string; color: string }>);
  }, [weekStart]);

  useEffect(() => { loadWeek(); }, [loadWeek]);
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(iv); }, []);

  // Map project titles to colors
  const projectColorMap: Record<string, string> = {};
  for (const p of projects) { projectColorMap[p.title] = p.color || "#e05555"; }

  const getTagColor = (text: string): string | null => {
    const match = text.match(/^\[(.+?)\]/);
    if (!match) return null;
    return projectColorMap[match[1]] || "#7c6fff";
  };

  const toggleTaskDone = async (task: WeekTask) => {
    const supabase = createClient();
    const newDone = !task.done;
    setTasks((prev) => {
      const copy = { ...prev };
      copy[task.date_key] = copy[task.date_key].map((t) => t.id === task.id ? { ...t, done: newDone } : t);
      return copy;
    });
    await supabase.from("week_tasks").update({ done: newDone }).eq("id", task.id);
    if (task.project_task_id) await syncWeekDoneToProject(supabase, task.id, newDone);
  };

  const addTask = async (dateKey: string) => {
    if (!newTaskText.trim()) return;
    const supabase = createClient();
    const existing = tasks[dateKey] || [];
    const text = newTaskText.trim();

    // Find project info for tagging
    const proj = linkProject ? projects.find((p) => p.id === linkProject) : null;
    const taggedText = proj ? `[${proj.title}] ${text}` : text;

    let projectTaskId: string | null = null;

    // Create project task/subtask if linked
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
      // For subtasks, link to the parent task
      if (sub) projectTaskId = linkParentTask;
    }

    await supabase.from("week_tasks").insert({
      user_id: userId, date_key: dateKey, text: taggedText,
      sort_order: existing.length,
      project_id: proj?.id || null,
      project_task_id: projectTaskId,
    });

    setNewTaskText("");
    setLinkProject(null);
    setLinkType("none");
    setLinkParentTask(null);
    setProjectTasks([]);
    loadWeek();
  };

  const loadProjectTasksForLink = async (projectId: string) => {
    const supabase = createClient();
    const { data } = await supabase.from("project_tasks")
      .select("id, name").eq("project_id", projectId).order("sort_order");
    setProjectTasks(data || []);
  };

  const deleteTask = async (id: string) => {
    const supabase = createClient();
    await supabase.from("week_tasks").delete().eq("id", id);
    loadWeek();
  };

  const saveTheme = async (dateKey: string, value: string) => {
    const supabase = createClient();
    const existing = dayMeta[dateKey];
    if (existing) {
      await supabase.from("week_days").update({ title: value }).eq("id", existing.id);
    } else {
      await supabase.from("week_days").upsert({ user_id: userId, date_key: dateKey, title: value, notes: "" }, { onConflict: "user_id,date_key" });
    }
    setEditingTheme(null);
    loadWeek();
  };

  const prevWeek = () => setWeekStart(addDays(weekStart, -7));
  const nextWeek = () => setWeekStart(addDays(weekStart, 7));
  const goToday = () => setWeekStart(getMonday(new Date()));

  // Stats
  const allTasks = Object.values(tasks).flat();
  const doneCount = allTasks.filter((t) => t.done).length;
  const totalCount = allTasks.length;

  // Per-project tag breakdown with colors
  const tagStats: Record<string, { done: number; total: number; color: string }> = {};
  for (const t of allTasks) {
    const match = t.text.match(/^\[(.+?)\]/);
    const tag = match ? match[1] : "No project";
    const color = match ? (projectColorMap[match[1]] || "#7c6fff") : "#5c5a7a";
    if (!tagStats[tag]) tagStats[tag] = { done: 0, total: 0, color };
    tagStats[tag].total++;
    if (t.done) tagStats[tag].done++;
  }

  const weekEndDate = addDays(weekStart, 6);
  const rangeLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

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
          <h1 className="font-title text-2xl text-bright">Weekly Planner</h1>
          <p className="text-sm text-txt2 mt-0.5">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm text-txt2 hover:text-txt hover:border-border2">‹ Prev</button>
          <button onClick={goToday} className="px-3 py-1.5 rounded-lg bg-violet/10 border border-violet/30 text-sm text-violet2 hover:bg-violet/20">Today</button>
          <button onClick={nextWeek} className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm text-txt2 hover:text-txt hover:border-border2">Next ›</button>
        </div>
      </div>

      {/* Weekly stats */}
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

      {/* 7-column grid */}
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
                {/* Editable theme/name */}
                {isEditingThis ? (
                  <input value={themeDraft} onChange={(e) => setThemeDraft(e.target.value)}
                    onBlur={() => saveTheme(dateKey, themeDraft)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveTheme(dateKey, themeDraft); if (e.key === "Escape") setEditingTheme(null); }}
                    className="text-[10px] text-txt bg-surface3 border border-border rounded px-1 py-0.5 w-full mt-0.5 outline-none"
                    autoFocus />
                ) : (
                  <p className="text-[10px] text-txt3 mt-0.5 truncate cursor-pointer hover:text-txt2 transition-colors"
                    onClick={(e) => { e.stopPropagation(); setEditingTheme(dateKey); setThemeDraft(theme); }}
                    title="Click to name this day">
                    {theme || "＋ name day"}
                  </p>
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
                  return (
                    <div key={t.id} className="flex items-start gap-1.5 text-xs group" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={t.done} onChange={() => toggleTaskDone(t)}
                        className="mt-0.5 w-3.5 h-3.5" style={{ accentColor: tagColor || color }} />
                      <span className={cn("leading-tight", t.done && "task-done")}>
                        {tagColor && (
                          <span className="font-medium" style={{ color: tagColor }}>
                            {t.text.match(/^\[.*?\]/)?.[0]}{" "}
                          </span>
                        )}
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
                return (
                  <div key={t.id} className={cn("flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-2.5 group", t.done && "opacity-60")}>
                    <input type="checkbox" checked={t.done} onChange={() => toggleTaskDone(t)}
                      className="w-4 h-4 shrink-0" style={{ accentColor: tagColor || modalColor }} />
                    <div className="flex-1 min-w-0">
                      <span className={cn("text-sm", t.done && "task-done")}>
                        {tagColor && (
                          <span className="font-medium text-xs px-1.5 py-0.5 rounded mr-1.5"
                            style={{ color: tagColor, backgroundColor: `${tagColor}15` }}>
                            {t.text.match(/^\[(.+?)\]/)?.[1]}
                          </span>
                        )}
                        {t.text.replace(/^\[.*?\]\s*/, "")}
                      </span>
                    </div>
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
