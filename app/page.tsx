"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { RoutineTask, Project, WeekTask, Deadline, ActivityLog, ProjectTask, WeeklyRoutineTask, MonthlyRoutineTask, QuickTask } from "@/lib/types";
import { ProgressBar } from "@/components/ProgressBar";
import { formatSeconds, formatDate, cn, getMonday, addDays, progressColor, getWeekKey, getMonthKey, LEGACY_TAG_RE, PRIORITY_COLORS, deadlineColor } from "@/lib/utils";
import { cleanupActivityLog } from "@/lib/db-helpers";
import { toggleWeekTaskDone } from "@/lib/day-blocks";
import { useToast } from "@/components/Toast";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { useSettings } from "@/lib/hooks/useSettings";
import { FeatureKey } from "@/lib/features";
import {
  fetchProjects, fetchRoutineWithChecks, fetchWeeklyRoutineWithChecks, fetchMonthlyRoutineWithChecks,
  fetchWeekTasksGrouped, fetchWeekTasksForDate, fetchUpcomingDeadlines,
  fetchRecentActivity, fetchOverdueTasks, fetchQuickTasks,
} from "@/lib/queries";
import Link from "next/link";
import { ListChecks, CalendarDays, RefreshCw, CalendarRange, BarChart3, Timer, AlertTriangle, Folder, Activity, ClipboardList, Settings, Trash2 } from "lucide-react";


/**
 * An empty card that does some work.
 *
 * "No tasks yet" repeated ten times is the literal first thing a new user
 * sees. Each card now says what it's for and offers the one action that fills
 * it, so the dashboard teaches instead of just being blank.
 */
function EmptyState({ children, action, href, onClick }: {
  children: React.ReactNode;
  action?: string;
  href?: string;
  onClick?: () => void;
}) {
  return (
    <div className="mt-2">
      <p className="text-xs text-txt3 leading-relaxed">{children}</p>
      {action && href && (
        <Link href={href}
          className="inline-flex items-center gap-1 mt-2 text-xs text-violet2 hover:text-violet transition-colors">
          {action} <span aria-hidden>→</span>
        </Link>
      )}
      {action && !href && onClick && (
        <button onClick={onClick}
          className="inline-flex items-center gap-1 mt-2 text-xs text-violet2 hover:text-violet transition-colors">
          {action} <span aria-hidden>→</span>
        </button>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { has } = useSettings();
  // Read through a ref inside the load effect so toggling a feature doesn't
  // re-trigger a full dashboard fetch.
  const hasRef = useRef(has);
  useEffect(() => { hasRef.current = has; }, [has]);
  const { user: currentUser, userId, loading: authLoading } = useCurrentUser();
  const [routine, setRoutine] = useState<RoutineTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [todayTasks, setTodayTasks] = useState<WeekTask[]>([]);
  const [weekTasks, setWeekTasks] = useState<WeekTask[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<Array<ProjectTask & { projectTitle: string; projectColor: string }>>([]);
  const [weeklyRoutine, setWeeklyRoutine] = useState<WeeklyRoutineTask[]>([]);
  const [monthlyRoutine, setMonthlyRoutine] = useState<MonthlyRoutineTask[]>([]);
  const [quickTasks, setQuickTasks] = useState<QuickTask[]>([]);
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);

  // Draggable card order
  const DEFAULT_CARD_ORDER = ["routine", "today", "weekly", "thisWeek", "monthly", "taskList", "overdue", "deadlines", "projects", "activity"];
  const [cardOrder, setCardOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return DEFAULT_CARD_ORDER;
    try {
      const saved = localStorage.getItem("dashboard-card-order");
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        // Merge: keep saved order but add any new cards not in saved
        const merged = parsed.filter((id: string) => DEFAULT_CARD_ORDER.includes(id));
        for (const id of DEFAULT_CARD_ORDER) {
          if (!merged.includes(id)) merged.push(id);
        }
        return merged;
      }
    } catch {}
    return DEFAULT_CARD_ORDER;
  });
  const [dragCardIdx, setDragCardIdx] = useState<number | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  /**
   * Remove planner rows whose originating project task no longer exists.
   *
   * This used to delete every unlinked planner row that had no matching
   * quick_task — which is exactly the shape of a task typed directly into the
   * planner. Naming a day's task by hand and then running "clean up" silently
   * destroyed it. Now only rows that point at a project task which has since
   * been deleted are considered orphaned; hand-written entries are left alone.
   */
  const cleanupOrphanedTasks = async () => {
    const supabase = createClient();

    const { data: linked, error: linkErr } = await supabase
      .from("week_tasks").select("id, project_task_id")
      .eq("user_id", userId).not("project_task_id", "is", null);

    if (linkErr) { toast("Cleanup failed: " + linkErr.message, "error"); return; }

    const referenced = Array.from(new Set((linked || []).map((r: { project_task_id: string }) => r.project_task_id)));
    if (referenced.length === 0) { toast("No orphaned tasks found", "success"); return; }

    const { data: alive, error: aliveErr } = await supabase
      .from("project_tasks").select("id").in("id", referenced);

    if (aliveErr) { toast("Cleanup failed: " + aliveErr.message, "error"); return; }

    const aliveIds = new Set((alive || []).map((t: { id: string }) => t.id));
    const toDelete = (linked || [])
      .filter((r: { project_task_id: string }) => !aliveIds.has(r.project_task_id))
      .map((r: { id: string }) => r.id);

    if (toDelete.length === 0) { toast("No orphaned tasks found", "success"); return; }

    // One statement instead of N sequential round trips.
    const { error: delErr } = await supabase.from("week_tasks").delete().in("id", toDelete);
    if (delErr) { toast("Cleanup failed: " + delErr.message, "error"); return; }

    toast(`Cleaned up ${toDelete.length} orphaned task(s)`, "success");
    const todayData = await fetchWeekTasksForDate(supabase, userId, today);
    setTodayTasks(todayData);
  };

  const today = formatDate(new Date());

  useEffect(() => { document.title = "Comfy Board — Dashboard"; }, []);

  useEffect(() => {
    if (authLoading || !userId) return;

    const load = async () => {
      const supabase = createClient();

      const monday = getMonday(new Date());
      const weekDates: string[] = [];
      for (let i = 0; i < 7; i++) weekDates.push(formatDate(addDays(monday, i)));
      const wKey = getWeekKey(new Date());
      const mKey = getMonthKey(new Date());
      // Feature state comes from the settings provider (DB-backed), not from
      // localStorage — otherwise the dashboard and /settings can disagree.
      const hasMonthly = hasRef.current("monthlyRoutine");

      try {
        const [
          routineData, projs, todayData, weekData,
          dl, act, overdue, wrData, qt,
        ] = await Promise.all([
          fetchRoutineWithChecks(supabase, userId, today),
          fetchProjects(supabase, userId),
          fetchWeekTasksForDate(supabase, userId, today),
          fetchWeekTasksGrouped(supabase, userId, weekDates),
          fetchUpcomingDeadlines(supabase, userId, 6),
          fetchRecentActivity(supabase, userId, 10),
          fetchOverdueTasks(supabase, userId, today),
          fetchWeeklyRoutineWithChecks(supabase, userId, wKey),
          fetchQuickTasks(supabase, userId),
        ]);

        setRoutine(routineData);
        setProjects(projs);
        setTodayTasks(todayData);
        setWeekTasks(Object.values(weekData).flat());
        setDeadlines(dl);
        setActivity(act);
        setOverdueTasks(overdue);
        setWeeklyRoutine(wrData);
        setQuickTasks(qt);

        // Fetch monthly if enabled (separate to avoid breaking if table doesn't exist)
        if (hasMonthly) {
          try {
            const mrData = await fetchMonthlyRoutineWithChecks(supabase, userId, mKey);
            setMonthlyRoutine(mrData);
          } catch { /* table may not exist yet */ }
        }

        // Cleanup old activity log entries
        cleanupActivityLog(supabase, userId);
      } catch (err) {
        console.error("Dashboard load failed:", err);
        toast("Failed to load dashboard data", "error");
      }

      setLoading(false);
    };
    load();

    // Quick capture can add a task from anywhere; refresh the cards it feeds.
    const onCaptured = () => load();
    window.addEventListener("quick-tasks-changed", onCaptured);
    return () => window.removeEventListener("quick-tasks-changed", onCaptured);
  }, [today, userId, authLoading]);

  useEffect(() => {
    // `now` only feeds a HH:MM clock and relative-time labels ("3h ago"), so a
    // 1s tick re-rendered all ten dashboard cards 60x/minute to produce an
    // identical DOM 59 of those times.
    const iv = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);

  // Toggle routine check from dashboard
  const toggleRoutine = async (task: RoutineTask) => {
    const supabase = createClient();
    const newChecked = !task.checked;
    setRoutine((prev) => prev.map((t) => t.id === task.id ? { ...t, checked: newChecked } : t));
    let error;
    if (newChecked) {
      ({ error } = await supabase.from("routine_checks").insert({ user_id: userId, task_id: task.id, checked_date: today }));
    } else {
      ({ error } = await supabase.from("routine_checks").delete().eq("task_id", task.id).eq("checked_date", today));
    }
    if (error) {
      toast("Failed to save: " + error.message, "error");
      setRoutine((prev) => prev.map((t) => t.id === task.id ? { ...t, checked: !newChecked } : t));
    }
  };

  const toggleTodayTask = async (task: WeekTask) => {
    const newDone = !task.done;
    setTodayTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, done: newDone } : t));
    const { error } = await toggleWeekTaskDone(createClient(), userId, task, newDone, "dashboard");
    if (error) {
      toast("Failed to save: " + error, "error");
      setTodayTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, done: !newDone } : t));
      return;
    }
    if (newDone && !task.project_task_id) {
      setQuickTasks((prev) => prev.filter((t) => !(t.name === task.text && t.date_key === task.date_key)));
    }
  };

  // Toggle weekly routine from dashboard
  const toggleWeeklyRoutine = async (task: WeeklyRoutineTask) => {
    const supabase = createClient();
    const newChecked = !task.checked;
    setWeeklyRoutine((prev) => prev.map((t) => t.id === task.id ? { ...t, checked: newChecked } : t));
    const wKey = getWeekKey(new Date());
    let error;
    if (newChecked) {
      ({ error } = await supabase.from("weekly_routine_checks").insert({ user_id: userId, task_id: task.id, week_key: wKey }));
    } else {
      ({ error } = await supabase.from("weekly_routine_checks").delete().eq("task_id", task.id).eq("week_key", wKey));
    }
    if (error) {
      toast("Failed to save: " + error.message, "error");
      setWeeklyRoutine((prev) => prev.map((t) => t.id === task.id ? { ...t, checked: !newChecked } : t));
    }
  };

  const toggleMonthlyRoutine = async (task: MonthlyRoutineTask) => {
    const supabase = createClient();
    const newChecked = !task.checked;
    setMonthlyRoutine((prev) => prev.map((t) => t.id === task.id ? { ...t, checked: newChecked } : t));
    const mKey = getMonthKey(new Date());
    let error;
    if (newChecked) {
      ({ error } = await supabase.from("monthly_routine_checks").insert({ user_id: userId, task_id: task.id, month_key: mKey }));
    } else {
      ({ error } = await supabase.from("monthly_routine_checks").delete().eq("task_id", task.id).eq("month_key", mKey));
    }
    if (error) {
      toast("Failed to save: " + error.message, "error");
      setMonthlyRoutine((prev) => prev.map((t) => t.id === task.id ? { ...t, checked: !newChecked } : t));
    }
  };

  const completeQuickTask = async (id: string) => {
    const supabase = createClient();
    const task = quickTasks.find((t) => t.id === id);
    await supabase.from("quick_tasks").delete().eq("id", id);
    setQuickTasks((prev) => prev.filter((t) => t.id !== id));
    // Clean up linked week_task
    if (task?.date_key) {
      await supabase.from("week_tasks").delete()
        .eq("user_id", userId).eq("text", task.name).eq("date_key", task.date_key);
      setTodayTasks((prev) => prev.filter((t) => !(t.text === task.name && t.date_key === task.date_key)));
    }
    // Clean up linked deadline
    if (task?.deadline) {
      await supabase.from("deadlines").delete().eq("user_id", userId).eq("label", task.name);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-violet border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const routineChecked = routine.filter((t) => t.checked).length;
  const routineTotal = routine.length;
  const routinePct = routineTotal > 0 ? Math.round((routineChecked / routineTotal) * 100) : 0;

  const todayDone = todayTasks.filter((t) => t.done).length;
  const todayTotal = todayTasks.length;

  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const getDeadlineText = (target: string) => {
    const diff = new Date(target).getTime() - now.getTime();
    if (diff <= 0) return "Passed";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h`;
    const min = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${min}m`;
  };

  const formatTimeAgo = (ts: string) => {
    const diff = now.getTime() - new Date(ts).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const wKey = getWeekKey(new Date());

  // Drag handlers for card reorder
  const handleCardDragStart = (idx: number) => setDragCardIdx(idx);
  const handleCardDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragCardIdx === null || dragCardIdx === idx) return;
    const newOrder = [...cardOrder];
    const [moved] = newOrder.splice(dragCardIdx, 1);
    newOrder.splice(idx, 0, moved);
    setCardOrder(newOrder);
    setDragCardIdx(idx);
  };
  const handleCardDragEnd = () => {
    setDragCardIdx(null);
    localStorage.setItem("dashboard-card-order", JSON.stringify(cardOrder));
  };

  // ── Card render functions ──────────────────────────────────

  /** Which feature each dashboard card belongs to. */
  const CARD_FEATURE: Record<string, FeatureKey | null> = {
    routine: "dailyRoutine", today: "planner", weekly: "weeklyRoutine",
    thisWeek: "planner", monthly: "monthlyRoutine", taskList: "taskList",
    overdue: "projects", deadlines: "deadlines", projects: "projects",
    activity: null,
  };

  const renderCard = (id: string, idx: number) => {
    const feature = CARD_FEATURE[id];
    if (feature && !has(feature)) return null;

    let content: React.ReactNode = null;

    switch (id) {
      case "routine": {
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 hover:border-border2 transition-colors card-float">
            <div className="flex items-center justify-between mb-3">
              <Link href="/routine" className="text-sm font-medium text-txt2 hover:text-red-acc transition-colors flex items-center gap-1.5"><ListChecks size={15} /> Daily Routine</Link>
              <span className="text-xs font-mono text-red-acc">{routineChecked}/{routineTotal}</span>
            </div>
            <ProgressBar value={routinePct} height={8} />
            <div className="mt-3 space-y-1.5">
              {routine.slice(0, 6).map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={t.checked || false} onChange={() => toggleRoutine(t)} className="w-3.5 h-3.5 shrink-0" />
                  <span className={cn("truncate", t.checked && "line-through text-txt3 opacity-60")}>{t.text}</span>
                </div>
              ))}
              {routineTotal > 6 && <Link href="/routine" className="text-[10px] text-txt3 hover:text-red-acc">+{routineTotal - 6} more →</Link>}
              {routineTotal === 0 && (
                <EmptyState action="Set up your daily routine" href="/routine">
                  The handful of things you do every morning. They reset overnight,
                  so you start each day with a clean list.
                </EmptyState>
              )}
            </div>
          </div>
        );
        break;
      }
      case "today": {
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 hover:border-border2 transition-colors card-float">
            <div className="flex items-center justify-between mb-3">
              <Link href={`/week/${today}`} className="text-sm font-medium text-txt2 hover:text-violet2 transition-colors flex items-center gap-1.5"><CalendarDays size={15} /> Today&apos;s Tasks</Link>
              <span className="text-xs font-mono text-muted-acc2">{todayDone}/{todayTotal}</span>
            </div>
            {todayTotal > 0 ? (
              <>
                <ProgressBar value={todayTotal > 0 ? (todayDone / todayTotal) * 100 : 0} height={8} />
                <div className="mt-3 space-y-1.5">
                  {todayTasks.slice(0, 6).map((t) => {
                    // Same coloured-border treatment as the planner — stripping
                    // the prefix without replacing it left three tasks from
                    // three projects rendering identically.
                    const proj = t.project_id ? projects.find((p) => p.id === t.project_id) : undefined;
                    const projColor = proj?.color || (t.project_id ? "#7c6fff" : null);
                    return (
                      <div key={t.id} className="flex items-center gap-2 text-xs pl-1.5"
                        style={projColor ? { borderLeft: `3px solid ${projColor}`, marginLeft: -1 } : undefined}
                        title={proj?.title}>
                        <input type="checkbox" checked={t.done || false} onChange={() => toggleTodayTask(t)}
                          aria-label={t.text} className="w-3.5 h-3.5 shrink-0" />
                        <span className={cn("truncate", t.done && "line-through text-txt3 opacity-60")}>
                          {t.subtask_id && <span className="text-txt3 mr-1" aria-hidden>↳</span>}
                          {t.project_id ? t.text.replace(LEGACY_TAG_RE, "") : t.text}
                        </span>
                      </div>
                    );
                  })}
                  {todayTotal > 6 && <Link href={`/week/${today}`} className="text-[10px] text-txt3 hover:text-violet2">+{todayTotal - 6} more →</Link>}
                </div>
              </>
            ) : (
              <EmptyState action="Open the planner" href="/week">
                Nothing scheduled for today. Give a task a{" "}
                <span className="text-txt2">Work on</span> date and it lands here.
              </EmptyState>
            )}
          </div>
        );
        break;
      }
      case "weekly": {
        const wrChecked = weeklyRoutine.filter((t) => t.checked).length;
        const wrTotal = weeklyRoutine.length;
        const wrPct = wrTotal > 0 ? Math.round((wrChecked / wrTotal) * 100) : 0;
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 card-float">
            <div className="flex items-center justify-between mb-3">
              <Link href="/weekly-routine" className="text-sm font-medium text-txt2 hover:text-violet2 transition-colors flex items-center gap-1.5"><RefreshCw size={15} /> Weekly Routine</Link>
              <span className="text-xs font-mono text-violet2">{wrChecked}/{wrTotal}</span>
            </div>
            {wrTotal > 0 ? (
              <>
                <ProgressBar value={wrPct} height={6} />
                <div className="mt-3 space-y-1.5">
                  {weeklyRoutine.slice(0, 6).map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={t.checked || false} onChange={() => toggleWeeklyRoutine(t)} className="w-3.5 h-3.5 shrink-0 accent-violet" />
                      <span className={cn("truncate", t.checked && "line-through text-txt3 opacity-60")}>{t.text}</span>
                    </div>
                  ))}
                  {wrTotal > 6 && <Link href="/weekly-routine" className="text-[10px] text-txt3 hover:text-violet2">+{wrTotal - 6} more →</Link>}
                </div>
              </>
            ) : (
              <p className="text-xs text-txt3 mt-2">No weekly routine set up · <Link href="/weekly-routine" className="text-violet2 hover:underline">Add tasks</Link></p>
            )}
          </div>
        );
        break;
      }
      case "thisWeek": {
        const weekDone = weekTasks.filter((t) => t.done).length;
        const weekTotal = weekTasks.length;
        const weekPct = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0;
        // Grouped by project_id, not by a tag parsed out of the row text —
        // renaming a project or moving a task used to mis-attribute these.
        const tagStats: Record<string, { done: number; total: number; color: string }> = {};
        const projById: Record<string, { title: string; color: string }> = {};
        for (const p of projects) projById[p.id] = { title: p.title, color: p.color || "#e05555" };
        for (const t of weekTasks) {
          const proj = t.project_id ? projById[t.project_id] : undefined;
          const tag = proj?.title ?? "Untagged";
          const color = proj?.color ?? "#5c5a7a";
          if (!tagStats[tag]) tagStats[tag] = { done: 0, total: 0, color };
          tagStats[tag].total++;
          if (t.done) tagStats[tag].done++;
        }
        content = (
          <Link href="/week" className="bg-surface border border-border rounded-xl p-4 block hover:border-border2 transition-colors group card-float">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-txt2 group-hover:text-violet2 transition-colors flex items-center gap-1.5"><BarChart3 size={15} /> This Week</h2>
              <span className="text-xs font-mono text-violet2">{weekDone}/{weekTotal} · {weekPct}%</span>
            </div>
            <ProgressBar value={weekPct} height={8} />
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.entries(tagStats).sort((a, b) => b[1].total - a[1].total).map(([tag, stats]) => (
                <div key={tag} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stats.color }} />
                  <span style={{ color: stats.color }}>{tag}</span>
                  <span className="text-txt3 font-mono">{stats.done}/{stats.total}</span>
                </div>
              ))}
            </div>
          </Link>
        );
        break;
      }
      case "monthly": {
        if (monthlyRoutine.length === 0) return null;
        const mrChecked = monthlyRoutine.filter((t) => t.checked).length;
        const mrTotal = monthlyRoutine.length;
        const mrPct = mrTotal > 0 ? Math.round((mrChecked / mrTotal) * 100) : 0;
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 card-float">
            <div className="flex items-center justify-between mb-3">
              <Link href="/monthly-routine" className="text-sm font-medium text-txt2 hover:text-violet2 transition-colors flex items-center gap-1.5"><CalendarRange size={15} /> Monthly Routine</Link>
              <span className="text-xs font-mono text-violet2">{mrChecked}/{mrTotal}</span>
            </div>
            <ProgressBar value={mrPct} height={6} />
            <div className="mt-3 space-y-1.5">
              {monthlyRoutine.slice(0, 6).map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={t.checked || false} onChange={() => toggleMonthlyRoutine(t)} className="w-3.5 h-3.5 shrink-0 accent-violet" />
                  <span className={cn("truncate", t.checked && "line-through text-txt3 opacity-60")}>{t.text}</span>
                </div>
              ))}
              {mrTotal > 6 && <Link href="/monthly-routine" className="text-[10px] text-txt3 hover:text-violet2">+{mrTotal - 6} more →</Link>}
            </div>
          </div>
        );
        break;
      }
      case "taskList": {
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 card-float">
            <div className="flex items-center justify-between mb-3">
              <Link href="/tasks" className="text-sm font-medium text-txt2 hover:text-violet2 transition-colors flex items-center gap-1.5"><ClipboardList size={15} /> Task List</Link>
              <span className="text-xs font-mono text-txt3">{quickTasks.length} tasks</span>
            </div>
            <div className="space-y-1.5">
              {quickTasks.slice(0, 6).map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs group">
                  <button onClick={() => completeQuickTask(t.id)} className="w-3.5 h-3.5 rounded border border-border hover:border-green-acc transition-colors shrink-0" />
                  <span className="truncate flex-1" style={{ color: PRIORITY_COLORS[t.priority] || "#eab308" }}>{t.name}</span>
                  {t.deadline && <span className="text-[10px] font-mono text-txt3 shrink-0">{t.deadline}</span>}
                </div>
              ))}
              {quickTasks.length > 6 && <Link href="/tasks" className="text-[10px] text-txt3 hover:text-violet2">+{quickTasks.length - 6} more →</Link>}
              {quickTasks.length === 0 && (
                <EmptyState action="Open your task list" href="/tasks">
                  Your inbox. Press <kbd className="bg-surface3 px-1 py-0.5 rounded">A</kbd> anywhere
                  to jot something down without deciding where it goes yet.
                </EmptyState>
              )}
            </div>
          </div>
        );
        break;
      }
      case "overdue": {
        if (overdueTasks.length === 0) return null;
        content = (
          <div className="bg-surface border border-danger/30 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-danger flex items-center gap-1.5"><AlertTriangle size={15} /> Overdue Tasks</h2>
              <span className="text-xs text-danger font-mono">{overdueTasks.length} late</span>
            </div>
            <div className="space-y-2">
              {overdueTasks.map((t) => {
                const daysLate = Math.ceil((Date.now() - new Date(t.deadline + "T23:59:00").getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <div key={t.id} className="flex items-center gap-3 bg-surface2 rounded-lg px-3 py-2 group">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.projectColor }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium" style={{ color: t.projectColor }}>[{t.projectTitle}]</span>
                        <span className="text-sm text-bright truncate">{t.name}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-danger font-mono">{daysLate}d late</span>
                        <span className="text-[10px] text-txt3">was due {t.deadline}</span>
                        <span className="text-[10px] font-mono" style={{ color: progressColor(t.progress) }}>{t.progress}%</span>
                      </div>
                    </div>
                    <input type="date" className="bg-surface3 border border-border rounded px-2 py-1 text-xs text-txt opacity-0 group-hover:opacity-100 transition-opacity"
                      onChange={async (e) => {
                        const newDate = e.target.value;
                        if (!newDate) return;
                        const supabase = (await import("@/lib/supabase")).createClient();
                        await supabase.from("project_tasks").update({ deadline: newDate }).eq("id", t.id);
                        setOverdueTasks((prev) => prev.filter((x) => x.id !== t.id));
                      }} />
                    <Link href={`/projects/${t.project_id}`}
                      className="text-xs text-txt3 hover:text-bright opacity-0 group-hover:opacity-100 transition-opacity">→</Link>
                  </div>
                );
              })}
            </div>
          </div>
        );
        break;
      }
      case "deadlines": {
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 card-float">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-txt2 flex items-center gap-1.5"><Timer size={15} /> Upcoming Deadlines</h2>
              <Link href="/deadlines" className="text-[10px] text-txt3 hover:text-violet2 transition-colors">View all →</Link>
            </div>
            <div className="space-y-2">
              {deadlines.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-1">
                  <span className="text-sm text-txt2 truncate flex-1">{d.label}</span>
                  <span className="text-xs font-mono ml-2 shrink-0" style={{ color: deadlineColor(d.target_datetime, now) }}>
                    {getDeadlineText(d.target_datetime)}
                  </span>
                </div>
              ))}
              {deadlines.length === 0 && (
                <EmptyState>
                  Nothing due. Give a task a <span className="text-txt2">Due</span> date
                  and its countdown appears here.
                </EmptyState>
              )}
            </div>
          </div>
        );
        break;
      }
      case "projects": {
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 card-float">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-txt2 flex items-center gap-1.5"><Folder size={15} /> Projects</h2>
              <Link href="/projects" className="text-[10px] text-txt3 hover:text-red-acc transition-colors">View all →</Link>
            </div>
            <div className="space-y-2">
              {projects.slice(0, 5).map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-2 py-1 group">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color || "#e05555" }} />
                  <span className="text-sm text-txt2 group-hover:text-bright transition-colors truncate flex-1">{p.title}</span>
                  {p.elapsed_seconds > 0 && (
                    <span className="text-[10px] font-mono text-txt3">{formatSeconds(p.elapsed_seconds)}</span>
                  )}
                </Link>
              ))}
              {projects.length === 0 && (
                <EmptyState action="Create your first project"
                  onClick={() => window.dispatchEvent(new Event("new-project"))}>
                  A project is work with a beginning and an end — it holds tasks,
                  which hold subtasks.
                </EmptyState>
              )}
            </div>
          </div>
        );
        break;
      }
      case "activity": {
        if (activity.length === 0) return null;
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 card-float">
            <h2 className="text-sm font-medium text-txt2 mb-3 flex items-center gap-1.5"><Activity size={15} /> Recent Activity</h2>
            <div className="space-y-1.5">
              {activity.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <span className="text-txt3 shrink-0 w-14 text-right font-mono">{formatTimeAgo(a.created_at)}</span>
                  <span className="text-border2">·</span>
                  <span className="text-txt2 truncate">
                    <span className="font-medium text-bright">{a.action}</span>
                    {a.detail && <span className="text-txt3"> — {a.detail}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
        break;
      }
      default:
        return null;
    }

    if (!content) return null;

    return (
      <div
        key={id}
        draggable
        onDragStart={() => handleCardDragStart(idx)}
        onDragOver={(e) => handleCardDragOver(e, idx)}
        onDragEnd={handleCardDragEnd}
        className={cn(
          "transition-all",
          dragCardIdx === idx && "opacity-50 scale-[0.98]",
          dragCardIdx !== null && dragCardIdx !== idx && "cursor-move"
        )}
      >
        {content}
      </div>
    );
  };

  // Filter visible cards
  const visibleCards = cardOrder.filter((id) => {
    if (id === "monthly" && monthlyRoutine.length === 0) return false;
    if (id === "overdue" && overdueTasks.length === 0) return false;
    if (id === "activity" && activity.length === 0) return false;
    return true;
  });

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs text-txt3 uppercase tracking-wider">{dateStr}</p>
        <div className="flex items-end gap-3 mt-1">
          <h1 className="font-title text-3xl text-bright">Comfy Board</h1>
          <span className="text-lg font-mono text-violet2 mb-0.5">{timeStr}</span>
          <div className="relative mb-1">
            <button onClick={() => setShowOptions(!showOptions)}
              className="flex items-center gap-1.5 text-xs text-txt3 hover:text-txt2 bg-surface border border-border hover:border-border2 rounded-lg px-2.5 py-1.5 transition-colors">
              <Settings size={14} /> Options
            </button>
            {showOptions && (
              <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg shadow-lg p-1 z-50 whitespace-nowrap">
                <button onClick={() => { cleanupOrphanedTasks(); setShowOptions(false); }}
                  className="flex items-center gap-2 px-3 py-2 text-xs text-txt2 hover:bg-surface3 rounded w-full text-left">
                  <Trash2 size={13} /> Clean up orphaned calendar tasks
                </button>
                <button onClick={() => { setCardOrder(DEFAULT_CARD_ORDER); localStorage.removeItem("dashboard-card-order"); setShowOptions(false); }}
                  className="flex items-center gap-2 px-3 py-2 text-xs text-txt2 hover:bg-surface3 rounded w-full text-left">
                  <RefreshCw size={13} /> Reset card layout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Draggable cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {visibleCards.map((id, idx) => renderCard(id, idx))}
      </div>
    </div>
  );
}
