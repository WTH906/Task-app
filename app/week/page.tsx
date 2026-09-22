"use client";

import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { WeekTask, WeekDay, QuickTask } from "@/lib/types";
import { getMonday, addDays, formatDate, DAY_COLORS, DAY_NAMES_FULL, cn, LEGACY_TAG_RE, PRIORITY_COLORS } from "@/lib/utils";
import { extendRecurringWeekTasks } from "@/lib/sync";
import { periodRange } from "@/lib/recurrence";
import { toggleWeekTaskDone } from "@/lib/day-blocks";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { fetchWeekTasksGrouped, fetchWeekDayMeta, fetchWeekTemplates, fetchProjectsSlim, fetchQuickTasks } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { CalendarDays, List, Clock, RefreshCw } from "lucide-react";
import { useSettings } from "@/lib/hooks/useSettings";
import { Modal } from "@/components/Modal";
import { DayGridPanel } from "@/components/DayGridPanel";
import { injectRoutineTasksForDay } from "@/lib/routine-scheduler";


const PRIORITY_TEXT_COLORS: Record<number, string> = {
  1: "#4ade80", 2: "#34d399", 3: "#eab308", 4: "#f97316", 5: "#ef4444",
};

/**
 * Legacy "[Project]" prefix. Rows created before migration v21 still carry it;
 * it is stripped at render time so old and new rows look identical.
 */

/**
 * The wall clock, isolated in its own component.
 *
 * This used to be `now` state on the page, re-set every second. Because none
 * of the page's derived data was memoised, that single tick re-ran every
 * colour map, every tag regex and a full vDOM pass over all seven day columns
 * — once per second, forever, even on an idle tab. Scoping it to a leaf means
 * the tick repaints ~20 characters instead of the whole planner.
 */
const LiveClock = memo(function LiveClock({ withSeconds = false }: { withSeconds?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    // Seconds need a 1s tick; the header clock only changes once a minute.
    const iv = setInterval(() => setNow(new Date()), withSeconds ? 1000 : 15000);
    return () => clearInterval(iv);
  }, [withSeconds]);
  if (!now) return null;
  return (
    <>
      {now.toLocaleTimeString("en-US", withSeconds
        ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" })}
    </>
  );
});

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
  const [editingTheme, setEditingTheme] = useState<string | null>(null);
  const [themeDraft, setThemeDraft] = useState("");

  const [jumpPickerOpen, setJumpPickerOpen] = useState(false);

  // The day whose hour grid is open in the popup, or null. The panel loads
  // and saves its own data — see components/DayGridPanel.tsx.
  const { has } = useSettings();
  const showScheduler = has("scheduler");
  const showRoutines = has("routineInScheduler");
  const [gridDate, setGridDate] = useState<string | null>(null);
  const [hideRoutine, setHideRoutine] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("comfy-hide-routine") === "1"; } catch { return false; }
  });
  const toggleHideRoutine = () => {
    setHideRoutine((prev) => {
      const next = !prev;
      try { localStorage.setItem("comfy-hide-routine", next ? "1" : "0"); } catch {}
      return next;
    });
  };
  const [expandedRoutineDays, setExpandedRoutineDays] = useState<Set<string>>(new Set());
  const toggleRoutineDay = (dateKey: string) => {
    setExpandedRoutineDays((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
      return next;
    });
  };

  const today = formatDate(new Date());

  // The set of dates currently on screen. Memoised so it isn't rebuilt (and
  // doesn't re-trigger the load effect) on every render.
  const visibleDates = useMemo(() => {
    const dates: string[] = [];
    if (viewMode === "week" || viewMode === "planner") {
      for (let i = 0; i < 7; i++) dates.push(formatDate(addDays(weekStart, i)));
    } else {
      const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const startPad = firstOfMonth.getDay() === 0 ? 6 : firstOfMonth.getDay() - 1;
      const startDate = addDays(firstOfMonth, -startPad);
      for (let i = 0; i < 42; i++) dates.push(formatDate(addDays(startDate, i)));
    }
    return dates;
  }, [weekStart, monthDate, viewMode]);

  const dateRangeKey = visibleDates.join(",");

  /** Range-dependent data — refetched when the user navigates weeks/months. */
  const loadRange = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();
      if (has("routineInScheduler") && viewMode !== "month") {
        await Promise.all(visibleDates.map((dk) => injectRoutineTasksForDay(supabase, userId, dk)));
      }
      const [grouped, meta] = await Promise.all([
        fetchWeekTasksGrouped(supabase, userId, visibleDates),
        fetchWeekDayMeta(supabase, userId, visibleDates),
      ]);
      setTasks(grouped);
      setDayMeta(meta);
    } catch (err) {
      console.error("Week load failed:", err);
      toast("Failed to load planner", "error");
    }
    // visibleDates is covered by dateRangeKey; using the key keeps the identity
    // stable so navigating back to a cached range doesn't refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRangeKey, userId, toast, has, viewMode]);

  /** User-scoped data — independent of the visible range, so fetched once. */
  const loadStatic = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();
      const [tmpl, projs, qt] = await Promise.all([
        fetchWeekTemplates(supabase, userId),
        fetchProjectsSlim(supabase, userId),
        fetchQuickTasks(supabase, userId),
      ]);
      setTemplates(tmpl);
      setProjects(projs);
      setQuickTasks(qt);
    } catch (err) {
      console.error("Week static load failed:", err);
    }
  }, [userId]);


  useEffect(() => { document.title = "Comfy Board — Week Planner"; }, []);

  // Navigating weeks/months no longer refetches projects, templates and quick
  // tasks — those don't depend on the range and used to cost 2.5x the queries.
  useEffect(() => { loadRange(); }, [loadRange]);
  useEffect(() => { loadStatic(); }, [loadStatic]);

  // Always call through a ref, never a captured `loadRange`: the effect below
  // is keyed on userId only, so a captured copy would be bound to the week
  // that was on screen at mount and could blank the week the user has since
  // navigated to.
  const loadRangeRef = useRef(loadRange);
  useEffect(() => { loadRangeRef.current = loadRange; }, [loadRange]);

  // Roll recurring tasks forward. Without this a "daily" task simply runs out
  // of generated occurrences and stops appearing mid-week.
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const supabase = createClient();
      const { added, error } = await extendRecurringWeekTasks(supabase, userId);
      if (error) { console.error("[recurrence:extend]", error); return; }
      if (added && added > 0) loadRangeRef.current();
    })();
    // Deliberately keyed on userId only: this is a once-per-visit top-up, not
    // something that should rerun on every week navigation.
     
  }, [userId]);

  // Projects indexed by id — the planner resolves a row's project through
  // week_tasks.project_id now, not by parsing a prefix out of its text.
  const projectsById = useMemo(() => {
    const map: Record<string, { title: string; color: string }> = {};
    for (const p of projects) map[p.id] = { title: p.title, color: p.color || "#e05555" };
    return map;
  }, [projects]);

  // Map quick task names to priority colors
  const quickTaskColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const qt of quickTasks) map[qt.name] = PRIORITY_TEXT_COLORS[qt.priority] || "#eab308";
    return map;
  }, [quickTasks]);

  /**
   * Pre-parsed presentation data, one entry per task, keyed by task id.
   *
   * The render path used to run up to five regexes per task per render
   * (~1400 for a full week) and recompute them on every keystroke and clock
   * tick. Now it happens once, when the underlying data changes.
   */
  const taskMeta = useMemo(() => {
    const meta = new Map<string, {
      projectTitle: string | null; color: string | null;
      isSub: boolean; body: string;
    }>();
    for (const list of Object.values(tasks)) {
      for (const t of list) {
        const proj = t.project_id ? projectsById[t.project_id] : undefined;
        const body = t.project_id ? t.text.replace(LEGACY_TAG_RE, "") : t.text;
        meta.set(t.id, {
          projectTitle: proj?.title ?? null,
          color: proj?.color ?? (quickTaskColorMap[t.text] || null),
          isSub: !!t.subtask_id,
          body: body || t.text,
        });
      }
    }
    return meta;
  }, [tasks, projectsById, quickTaskColorMap]);

  const metaFor = useCallback(
    (t: WeekTask) => taskMeta.get(t.id) ?? { projectTitle: null, color: null, isSub: !!t.subtask_id, body: t.text },
    [taskMeta]
  );

  /** Rows still awaiting their server-assigned id can't be written to yet. */
  const isPending = (id: string) => id.startsWith("temp-");

  const toggleTaskDone = async (task: WeekTask) => {
    if (isPending(task.id)) return;
    const newDone = !task.done;

    setTasks((prev) => {
      const copy = { ...prev };
      copy[task.date_key] = copy[task.date_key].map((t) => t.id === task.id ? { ...t, done: newDone } : t);
      return copy;
    });

    const res = await toggleWeekTaskDone(createClient(), userId, task, newDone, "planner");
    if (res.error) {
      setTasks((prev) => {
        const copy = { ...prev };
        copy[task.date_key] = copy[task.date_key].map((t) => t.id === task.id ? { ...t, done: !newDone } : t);
        return copy;
      });
      toast("Failed to save: " + res.error, "error");
      return;
    }

    if (res.recurrence && res.periodKey) {
      const range = periodRange(res.recurrence, res.periodKey);
      if (range) {
        setTasks((prev) => {
          const copy = { ...prev };
          for (const dk of Object.keys(copy)) {
            if (dk < range.start || dk > range.end) continue;
            copy[dk] = copy[dk].map((t) =>
              t.project_task_id === task.project_task_id && !t.subtask_id ? { ...t, done: newDone } : t
            );
          }
          return copy;
        });
      }
    }

    if (newDone && !task.project_task_id) {
      setQuickTasks((prev) => prev.filter((q) => !(q.name === task.text && q.date_key === task.date_key)));
    }
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
  const goToday = () => router.push(`/week/${today}`);
  const prevMonth = () => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1));
  const nextMonth = () => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1));

  const jumpToDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    setWeekStart(getMonday(d));
    setMonthDate(d);
    setJumpPickerOpen(false);
  };

  // Stats — one pass over the range instead of four filters plus a regex per
  // task, recomputed on every keystroke and clock tick.
  const { rescheduledTotal, doneCount, totalCount, tagStats } = useMemo(() => {
    let done = 0, total = 0, rescheduled = 0;
    const stats: Record<string, { done: number; total: number; color: string }> = {};
    for (const list of Object.values(tasks)) {
      for (const t of list) {
        if (t.rescheduled_to) { rescheduled++; } else { total++; if (t.done) done++; }
        // Rescheduled rows are excluded from the per-tag chips too, so they
        // agree with the "Week: x/y" headline directly above them.
        if (t.rescheduled_to) continue;
        const parsed = taskMeta.get(t.id);
        const tag = parsed?.projectTitle ?? "Task list";
        const color = parsed?.projectTitle ? (parsed.color || "#7c6fff") : "#eab308";
        if (!stats[tag]) stats[tag] = { done: 0, total: 0, color };
        stats[tag].total++;
        if (t.done) stats[tag].done++;
      }
    }
    return { rescheduledTotal: rescheduled, doneCount: done, totalCount: total, tagStats: stats };
  }, [tasks, taskMeta]);

  const sortedTagStats = useMemo(
    () => Object.entries(tagStats).sort((a, b) => b[1].total - a[1].total),
    [tagStats]
  );

  // Intl formatter construction is expensive; only redo it when the range moves.
  const rangeLabel = useMemo(() => {
    if (viewMode === "planner") return `${quickTasks.length} tasks`;
    if (viewMode === "week") {
      const end = addDays(weekStart, 6);
      return `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [viewMode, weekStart, monthDate, quickTasks.length]);

  // The week columns and month cells share the memoised range.
  const monthGridDates = viewMode === "month" ? visibleDates : [];

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      return { date, dateKey: formatDate(date), dayNum: date.getDay() };
    }),
    [weekStart]
  );

  // Modal

  return (
    <div className="p-4 md:p-6 flex flex-col h-[100dvh]">
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
          {showRoutines && (
            <button onClick={toggleHideRoutine}
              title={hideRoutine ? "Show routine tasks" : "Hide routine tasks"}
              className={cn("px-2 py-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors",
                hideRoutine ? "border-border text-txt3 hover:text-violet2 hover:border-border2" : "border-violet/30 bg-violet/10 text-violet2")}>
              <RefreshCw size={11} />
            </button>
          )}
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
          {rescheduledTotal > 0 && <span className="text-xs text-amber font-mono ml-2">{rescheduledTotal} rescheduled</span>}
          {totalCount > 0 && (
            <div className="w-32 h-2 bg-surface3 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-violet transition-all" style={{ width: `${(doneCount / totalCount) * 100}%` }} />
            </div>
          )}
          {totalCount > 0 && <span className="text-xs text-txt3">{Math.round((doneCount / totalCount) * 100)}%</span>}
        </div>
        {Object.keys(tagStats).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {sortedTagStats.map(([tag, stats]) => {
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
          {weekDays.map(({ date, dateKey, dayNum }) => {
            const color = DAY_COLORS[dayNum];
            const isToday = dateKey === today;
            const allDayTasks = (tasks[dateKey] || []).filter(t => !t.rescheduled_to);
            const projectTasks = allDayTasks.filter(t => !t.routine_task_id);
            const routineTasks = allDayTasks.filter(t => !!t.routine_task_id);
            const routineExpanded = expandedRoutineDays.has(dateKey);
            const rescheduledCount = (tasks[dateKey] || []).filter(t => t.rescheduled_to).length;
            const doneTasks = projectTasks.filter((t) => t.done).length;
            const theme = dayMeta[dateKey]?.title || templates[dayNum] || "";
            const isEditingThis = editingTheme === dateKey;

            return (
              <div key={dateKey}
                className={cn("bg-surface border rounded-xl p-3 flex flex-col transition-all card-float",
                  isToday ? "border-violet shadow-lg shadow-violet/10" : "border-border hover:border-border2")}>
                <div className="mb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider cursor-pointer" style={{ color }}
                      onClick={() => router.push(`/week/${dateKey}`)}>
                      {DAY_NAMES_FULL[dayNum].slice(0, 3)}
                    </span>
                    {/*
                      Peek at this day's hours without leaving the week. Only
                      offered when the scheduler is on — with it off there is
                      no hour grid for the popup to show.
                    */}
                    {showScheduler && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setGridDate(dateKey); }}
                        title={`Hours for ${DAY_NAMES_FULL[dayNum]} ${date.getDate()}`}
                        aria-label={`Open the hour grid for ${DAY_NAMES_FULL[dayNum]} ${date.getDate()}`}
                        className="w-5 h-5 flex items-center justify-center rounded text-txt3 hover:text-violet2 hover:bg-surface2 transition-colors"
                      >
                        <Clock size={12} />
                      </button>
                    )}
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
                      <LiveClock />
                    </p>
                  )}
                </div>
                <div className="flex-1 space-y-1 overflow-y-auto min-h-0 cursor-pointer"
                  onClick={() => router.push(`/week/${dateKey}`)}>
                  {projectTasks.map((t) => {
                    const { color: projColor, projectTitle, isSub, body } = metaFor(t);
                    return (
                      /* The project used to be spelled out as a "[Project]" prefix,
                         which ate ~40% of this column's width. It's now a 3px
                         border in the project's colour — same information, one
                         pixel-column instead of half the line. */
                      <div key={t.id}
                        className="flex items-start gap-1.5 text-xs group pl-1.5"
                        style={projColor ? { borderLeft: `3px solid ${projColor}`, marginLeft: -1 } : undefined}
                        title={projectTitle ? `${projectTitle}${isSub ? " · subtask" : ""}` : undefined}
                        onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={t.done} onChange={() => toggleTaskDone(t)}
                          disabled={isPending(t.id)}
                          aria-label={body}
                          className="mt-0.5 w-3.5 h-3.5" style={{ accentColor: projColor || color }} />
                        <span className={cn("leading-tight", t.done && "line-through text-txt3 opacity-60", t.project_id && "cursor-pointer hover:underline")}
                          onClick={() => { if (t.project_id) router.push(`/projects/${t.project_id}`); }}>
                          {isSub && <span className="text-txt3 mr-0.5" aria-hidden>↳</span>}
                          {body}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {!hideRoutine && routineTasks.length > 0 && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); toggleRoutineDay(dateKey); }}
                      className="mt-1.5 w-full flex items-center gap-1.5 text-[10px] text-txt3 hover:text-violet2 transition-colors py-1">
                      <span className="flex-1 h-px bg-border/40" />
                      <RefreshCw size={9} className="text-violet2/50" />
                      <span className="font-mono">{routineTasks.filter(t => t.done).length}/{routineTasks.length}</span>
                      <span className="text-[8px]">{routineExpanded ? "▲" : "▼"}</span>
                      <span className="flex-1 h-px bg-border/40" />
                    </button>
                    {routineExpanded && (
                      <div className="space-y-1 pb-1">
                        {routineTasks.map((t) => (
                          <div key={t.id} className="flex items-start gap-1.5 text-xs pl-1.5"
                            onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={t.done} onChange={() => toggleTaskDone(t)}
                              disabled={isPending(t.id)}
                              className="mt-0.5 w-3.5 h-3.5" style={{ accentColor: color }} />
                            <span className={cn("leading-tight text-violet2/80", t.done && "line-through text-txt3 opacity-60")}>
                              {t.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-end gap-2">
                  {rescheduledCount > 0 && <span className="text-[9px] text-amber font-mono">{rescheduledCount}↷</span>}
                  {projectTasks.length > 0 && <span className="text-[10px] text-txt3 font-mono">{doneTasks}/{projectTasks.length}</span>}
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
              const allMonthDayTasks = tasks[dateKey] || [];
              const dayTasks = hideRoutine ? allMonthDayTasks.filter(t => !t.routine_task_id) : allMonthDayTasks;
              const doneTasks = dayTasks.filter((t) => t.done).length;
              const theme = dayMeta[dateKey]?.title || "";

              return (
                <div key={dateKey}
                  onClick={() => router.push(`/week/${dateKey}`)}
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
                      const { color: projColor, projectTitle, body } = metaFor(t);
                      return (
                        <div key={t.id} className="flex items-center gap-1 text-[10px] leading-tight shrink-0"
                          title={projectTitle || undefined} onClick={(e) => e.stopPropagation()}>
                          <span className="w-1 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: projColor || "transparent" }} aria-hidden />
                          <input type="checkbox" checked={t.done} onChange={() => toggleTaskDone(t)}
                            disabled={isPending(t.id)} aria-label={body}
                            className="w-3 h-3 shrink-0" style={{ accentColor: projColor || DAY_COLORS[dayNum] }} />
                          <span className={cn("truncate", t.done && "line-through text-txt3 opacity-60")}>{body}</span>
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

      {/*
        A day's hours, without leaving the week.

        The panel loads and saves its own data through lib/day-blocks.ts —
        the same functions the full day page uses — so what you change here
        and what you'd see there cannot disagree. `onChanged` refreshes the
        week grid behind it, since the popup's edits move blocks the day
        columns are also drawing.
      */}
      {gridDate && (
        <Modal
          open
          onClose={() => setGridDate(null)}
          maxWidth="max-w-5xl"
          title={new Date(gridDate + "T00:00:00").toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric",
          })}
        >
          <DayGridPanel
            dateKey={gridDate}
            userId={userId}
            projectColorById={Object.fromEntries(
              Object.entries(projectsById).map(([id, p]) => [id, p.color])
            )}
            projectTitleById={Object.fromEntries(
              Object.entries(projectsById).map(([id, p]) => [id, p.title])
            )}
            onChanged={() => loadRangeRef.current()}
          />
        </Modal>
      )}
    </div>
  );
}
