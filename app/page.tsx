"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { RoutineTask, Project, WeekTask, Deadline, ActivityLog, ProjectTask, WeeklyRoutineTask, MonthlyRoutineTask, QuickTask } from "@/lib/types";
import { ProgressBar } from "@/components/ProgressBar";
import { formatSeconds, formatDate, cn, getMonday, addDays, progressColor, getWeekKey, getMonthKey } from "@/lib/utils";
import { cleanupActivityLog } from "@/lib/db-helpers";
import { useToast } from "@/components/Toast";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import {
  fetchProjects, fetchRoutineWithChecks, fetchWeeklyRoutineWithChecks, fetchMonthlyRoutineWithChecks,
  fetchWeekTasksGrouped, fetchWeekTasksForDate, fetchUpcomingDeadlines,
  fetchRecentActivity, fetchOverdueTasks, fetchQuickTasks,
} from "@/lib/queries";
import Link from "next/link";
import { ListChecks, CalendarDays, RefreshCw, CalendarRange, BarChart3, Timer, AlertTriangle, Folder, Activity, ClipboardList, Settings, Trash2 } from "lucide-react";

const PRIORITY_COLORS: Record<number, string> = {
  1: "#4ade80", 2: "#34d399", 3: "#eab308", 4: "#f97316", 5: "#ef4444",
};

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
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
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
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

  const cleanupOrphanedTasks = async () => {
    const supabase = createClient();
    const { data: qts } = await supabase.from("quick_tasks").select("name, date_key").eq("user_id", userId);
    const qtKeys = new Set((qts || []).map((q: { name: string; date_key: string | null }) => `${q.name}::${q.date_key}`));
    const { data: orphans } = await supabase.from("week_tasks").select("id, text, date_key")
      .eq("user_id", userId).is("project_task_id", null).is("project_id", null);
    const toDelete = (orphans || []).filter((t: { text: string; date_key: string }) => !qtKeys.has(`${t.text}::${t.date_key}`));
    if (toDelete.length === 0) { toast("No orphaned tasks found", "success"); return; }
    for (const t of toDelete) {
      await supabase.from("week_tasks").delete().eq("id", t.id);
    }
    toast(`Cleaned up ${toDelete.length} orphaned task(s)`, "success");
    const todayData = await fetchWeekTasksForDate(supabase, userId, today);
    setTodayTasks(todayData);
  };

  const today = formatDate(new Date());

  useEffect(() => {
    if (authLoading || !userId) return;

    const load = async () => {
      const supabase = createClient();

      const monday = getMonday(new Date());
      const weekDates: string[] = [];
      for (let i = 0; i < 7; i++) weekDates.push(formatDate(addDays(monday, i)));
      const wKey = getWeekKey(new Date());
      const mKey = getMonthKey(new Date());
      const hasMonthly = localStorage.getItem("comfy-monthly-routine") === "true";
      setMonthlyEnabled(hasMonthly);

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
  }, [today, userId, authLoading]);

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
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

  // Toggle today's week task from dashboard
  const toggleTodayTask = async (task: WeekTask) => {
    const supabase = createClient();
    const newDone = !task.done;
    setTodayTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, done: newDone } : t));
    const { error } = await supabase.from("week_tasks").update({ done: newDone }).eq("id", task.id);
    if (error) {
      toast("Failed to save: " + error.message, "error");
      setTodayTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, done: !newDone } : t));
      return;
    }
    if (task.project_task_id) {
      const isSubtaskEntry = task.text.includes("↳");
      const newProgress = newDone ? 100 : 0;

      if (isSubtaskEntry) {
        // This week_task represents a specific subtask — update only that one
        const subName = task.text.split("↳").pop()?.trim() || "";
        const { data: matchedSub } = await supabase
          .from("subtasks").select("id").eq("task_id", task.project_task_id)
          .ilike("name", subName).limit(1).maybeSingle();
        if (matchedSub) {
          await supabase.from("subtasks").update({ progress: newProgress }).eq("id", matchedSub.id);
        }
        // Recalc parent from all subtasks
        const { data: allSubs } = await supabase
          .from("subtasks").select("progress").eq("task_id", task.project_task_id);
        if (allSubs && allSubs.length > 0) {
          const avg = Math.round(allSubs.reduce((s, st) => s + st.progress, 0) / allSubs.length);
          await supabase.from("project_tasks").update({ progress: avg }).eq("id", task.project_task_id);
        }
      } else {
        // Main task entry
        const { data: subs } = await supabase.from("subtasks").select("id").eq("task_id", task.project_task_id).limit(1);
        if (!subs || subs.length === 0) {
          await supabase.from("project_tasks").update({ progress: newProgress }).eq("id", task.project_task_id);
        } else {
          await supabase.from("subtasks").update({ progress: newProgress }).eq("task_id", task.project_task_id);
          await supabase.from("project_tasks").update({ progress: newProgress }).eq("id", task.project_task_id);
        }
      }
    }
    // If marking done and this came from a quick task, remove it
    if (newDone && !task.project_task_id) {
      await supabase.from("quick_tasks").delete()
        .eq("user_id", userId).eq("name", task.text).eq("date_key", task.date_key);
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

  const getDeadlineColor = (target: string) => {
    const diff = new Date(target).getTime() - now.getTime();
    if (diff < 24 * 60 * 60 * 1000) return "#f43f5e";
    if (diff < 3 * 24 * 60 * 60 * 1000) return "#f59e0b";
    return "#4caf50";
  };

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

  const renderCard = (id: string, idx: number) => {
    let content: React.ReactNode = null;

    switch (id) {
      case "routine": {
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 hover:border-border2 transition-colors h-full">
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
              {routineTotal === 0 && <p className="text-xs text-txt3">No daily routine set up</p>}
            </div>
          </div>
        );
        break;
      }
      case "today": {
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 hover:border-border2 transition-colors h-full">
            <div className="flex items-center justify-between mb-3">
              <Link href={`/week/${today}`} className="text-sm font-medium text-txt2 hover:text-violet2 transition-colors flex items-center gap-1.5"><CalendarDays size={15} /> Today&apos;s Tasks</Link>
              <span className="text-xs font-mono text-violet2">{todayDone}/{todayTotal}</span>
            </div>
            {todayTotal > 0 ? (
              <>
                <ProgressBar value={todayTotal > 0 ? (todayDone / todayTotal) * 100 : 0} height={8} />
                <div className="mt-3 space-y-1.5">
                  {todayTasks.slice(0, 6).map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={t.done || false} onChange={() => toggleTodayTask(t)} className="w-3.5 h-3.5 shrink-0" />
                      <span className={cn("truncate", t.done && "line-through text-txt3 opacity-60")}>
                        {t.project_id && <span className="text-violet2 font-medium">{t.text.match(/^\[.*?\]/)?.[0]} </span>}
                        {t.text.replace(/^\[.*?\]\s*/, "")}
                      </span>
                    </div>
                  ))}
                  {todayTotal > 6 && <Link href={`/week/${today}`} className="text-[10px] text-txt3 hover:text-violet2">+{todayTotal - 6} more →</Link>}
                </div>
              </>
            ) : (
              <p className="text-xs text-txt3 mt-2">No tasks scheduled for today</p>
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
          <div className="bg-surface border border-border rounded-xl p-4 h-full">
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
        const tagStats: Record<string, { done: number; total: number; color: string }> = {};
        const projColorMap: Record<string, string> = {};
        for (const p of projects) projColorMap[p.title] = p.color || "#e05555";
        for (const t of weekTasks) {
          const match = t.text.match(/^\[(.+?)\]/);
          const tag = match ? match[1] : "Untagged";
          const color = match ? (projColorMap[match[1]] || "#7c6fff") : "#5c5a7a";
          if (!tagStats[tag]) tagStats[tag] = { done: 0, total: 0, color };
          tagStats[tag].total++;
          if (t.done) tagStats[tag].done++;
        }
        content = (
          <Link href="/week" className="bg-surface border border-border rounded-xl p-4 block hover:border-border2 transition-colors group h-full">
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
        if (!monthlyEnabled || monthlyRoutine.length === 0) return null;
        const mrChecked = monthlyRoutine.filter((t) => t.checked).length;
        const mrTotal = monthlyRoutine.length;
        const mrPct = mrTotal > 0 ? Math.round((mrChecked / mrTotal) * 100) : 0;
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 h-full">
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
          <div className="bg-surface border border-border rounded-xl p-4 h-full">
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
              {quickTasks.length === 0 && <p className="text-xs text-txt3">No quick tasks</p>}
            </div>
          </div>
        );
        break;
      }
      case "overdue": {
        if (overdueTasks.length === 0) return null;
        content = (
          <div className="bg-surface border border-danger/30 rounded-xl p-4 h-full">
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
          <div className="bg-surface border border-border rounded-xl p-4 h-full">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-txt2 flex items-center gap-1.5"><Timer size={15} /> Upcoming Deadlines</h2>
              <Link href="/deadlines" className="text-[10px] text-txt3 hover:text-violet2 transition-colors">View all →</Link>
            </div>
            <div className="space-y-2">
              {deadlines.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-1">
                  <span className="text-sm text-txt2 truncate flex-1">{d.label}</span>
                  <span className="text-xs font-mono ml-2 shrink-0" style={{ color: getDeadlineColor(d.target_datetime) }}>
                    {getDeadlineText(d.target_datetime)}
                  </span>
                </div>
              ))}
              {deadlines.length === 0 && <p className="text-xs text-txt3">No upcoming deadlines</p>}
            </div>
          </div>
        );
        break;
      }
      case "projects": {
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 h-full">
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
              {projects.length === 0 && <p className="text-xs text-txt3">No projects yet</p>}
            </div>
          </div>
        );
        break;
      }
      case "activity": {
        if (activity.length === 0) return null;
        content = (
          <div className="bg-surface border border-border rounded-xl p-4 h-full">
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
    if (id === "monthly" && (!monthlyEnabled || monthlyRoutine.length === 0)) return false;
    if (id === "overdue" && overdueTasks.length === 0) return false;
    if (id === "activity" && activity.length === 0) return false;
    return true;
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs text-txt3 uppercase tracking-wider">{dateStr}</p>
        <div className="flex items-end gap-3 mt-1">
          <h1 className="font-title text-3xl text-bright">Comfy Board</h1>
          <span className="text-lg font-mono text-violet2 mb-0.5">{timeStr}</span>
          <div className="relative mb-1">
            <button onClick={() => setShowOptions(!showOptions)} className="text-txt3 hover:text-txt2 transition-colors">
              <Settings size={16} />
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleCards.map((id, idx) => renderCard(id, idx))}
      </div>
    </div>
  );
}
