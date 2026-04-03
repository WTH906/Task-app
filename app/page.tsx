"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { RoutineTask, Project, WeekTask, Deadline, ActivityLog } from "@/lib/types";
import { ProgressBar } from "@/components/ProgressBar";
import { formatSeconds, toLocalDateStr, cn, getMonday, addDays, formatDate } from "@/lib/utils";
import Link from "next/link";

export default function DashboardPage() {
  const router = useRouter();
  const [routine, setRoutine] = useState<RoutineTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [todayTasks, setTodayTasks] = useState<WeekTask[]>([]);
  const [weekTasks, setWeekTasks] = useState<WeekTask[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);

  const today = toLocalDateStr(new Date());

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Routine
      const { data: tasks } = await supabase.from("routine_tasks").select("*").eq("user_id", user.id).order("sort_order");
      const { data: checks } = await supabase.from("routine_checks").select("task_id").eq("user_id", user.id).eq("checked_date", today);
      const checkedIds = new Set((checks || []).map((c: { task_id: string }) => c.task_id));
      setRoutine((tasks || []).map((t: RoutineTask) => ({ ...t, checked: checkedIds.has(t.id) })));

      // Projects
      const { data: projs } = await supabase.from("projects").select("*").eq("user_id", user.id).order("sort_order");
      setProjects(projs || []);

      // Today's week tasks
      const { data: wt } = await supabase.from("week_tasks").select("*").eq("user_id", user.id).eq("date_key", today).order("sort_order");
      setTodayTasks(wt || []);

      // Full week tasks
      const monday = getMonday(new Date());
      const weekDates: string[] = [];
      for (let i = 0; i < 7; i++) weekDates.push(formatDate(addDays(monday, i)));
      const { data: allWt } = await supabase.from("week_tasks").select("*").eq("user_id", user.id).in("date_key", weekDates);
      setWeekTasks(allWt || []);

      // Upcoming deadlines (next 7 days)
      const { data: dl } = await supabase.from("deadlines").select("*").eq("user_id", user.id)
        .gte("target_datetime", new Date().toISOString())
        .order("target_datetime").limit(6);
      setDeadlines(dl || []);

      // Recent activity
      const { data: act } = await supabase.from("activity_log").select("*").eq("user_id", user.id)
        .order("created_at", { ascending: false }).limit(10);
      setActivity(act || []);

      setLoading(false);
    };
    load();
  }, [today]);

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

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

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs text-txt3 uppercase tracking-wider">{dateStr}</p>
        <div className="flex items-end gap-3 mt-1">
          <h1 className="font-title text-3xl text-bright">Comfy Board</h1>
          <span className="text-lg font-mono text-violet2 mb-0.5">{timeStr}</span>
        </div>
      </div>

      {/* Top row: Routine + Today */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Routine card */}
        <Link href="/routine" className="bg-surface border border-border rounded-xl p-4 hover:border-border2 transition-colors group">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-txt2 group-hover:text-red-acc transition-colors">☰ Daily Routine</h2>
            <span className="text-xs font-mono text-red-acc">{routineChecked}/{routineTotal}</span>
          </div>
          <ProgressBar value={routinePct} height={8} />
          <div className="mt-3 space-y-1">
            {routine.slice(0, 4).map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs">
                <span className={t.checked ? "text-green-acc" : "text-txt3"}>{t.checked ? "✓" : "○"}</span>
                <span className={cn("truncate", t.checked && "task-done")}>{t.text}</span>
              </div>
            ))}
            {routineTotal > 4 && <p className="text-[10px] text-txt3">+{routineTotal - 4} more</p>}
          </div>
        </Link>

        {/* Today's tasks card */}
        <Link href={`/week/${today}`} className="bg-surface border border-border rounded-xl p-4 hover:border-border2 transition-colors group">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-txt2 group-hover:text-violet2 transition-colors">📅 Today&apos;s Tasks</h2>
            <span className="text-xs font-mono text-violet2">{todayDone}/{todayTotal}</span>
          </div>
          {todayTotal > 0 ? (
            <>
              <ProgressBar value={todayTotal > 0 ? (todayDone / todayTotal) * 100 : 0} height={8} />
              <div className="mt-3 space-y-1">
                {todayTasks.slice(0, 4).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs">
                    <span className={t.done ? "text-green-acc" : "text-txt3"}>{t.done ? "✓" : "○"}</span>
                    <span className={cn("truncate", t.done && "task-done")}>
                      {t.project_id && <span className="text-violet2 font-medium">{t.text.match(/^\[.*?\]/)?.[0]} </span>}
                      {t.text.replace(/^\[.*?\]\s*/, "")}
                    </span>
                  </div>
                ))}
                {todayTotal > 4 && <p className="text-[10px] text-txt3">+{todayTotal - 4} more</p>}
              </div>
            </>
          ) : (
            <p className="text-xs text-txt3 mt-2">No tasks scheduled for today</p>
          )}
        </Link>
      </div>

      {/* Weekly overview */}
      {weekTasks.length > 0 && (() => {
        const weekDone = weekTasks.filter((t) => t.done).length;
        const weekTotal = weekTasks.length;
        const weekPct = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0;

        // Per-project breakdown
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

        return (
          <Link href="/week" className="bg-surface border border-border rounded-xl p-4 mb-4 block hover:border-border2 transition-colors group">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-txt2 group-hover:text-violet2 transition-colors">📊 This Week</h2>
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
      })()}

      {/* Middle row: Projects + Deadlines */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Projects */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-txt2">📁 Projects</h2>
            <Link href="/projects" className="text-[10px] text-txt3 hover:text-red-acc transition-colors">View all →</Link>
          </div>
          <div className="space-y-2">
            {projects.slice(0, 5).map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}
                className="flex items-center gap-2 py-1 group">
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

        {/* Deadlines */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-txt2">⏳ Upcoming Deadlines</h2>
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
      </div>

      {/* Activity log */}
      {activity.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-4">
          <h2 className="text-sm font-medium text-txt2 mb-3">🕐 Recent Activity</h2>
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
      )}
    </div>
  );
}
