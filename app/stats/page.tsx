"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { formatSeconds, cn, getWeekKey, getMonthKey, formatDate, getMonday, addDays } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { useToast } from "@/components/Toast";
import {
  PieChart, CheckCircle, Clock, Target, Flame, Trophy,
  ListChecks, RefreshCw, CalendarRange, Folder, ClipboardList,
  TrendingUp, TrendingDown, Minus, Calendar, BarChart3,
} from "lucide-react";

interface Stats {
  // Completion
  totalProjects: number;
  archivedProjects: number;
  totalTasks: number;
  completedTasks: number;
  totalSubtasks: number;
  completedSubtasks: number;
  quickTasksCompleted: number;
  // Time
  totalTrackedSeconds: number;
  taskTrackedSeconds: number;
  subtaskTrackedSeconds: number;
  // Routines
  dailyRoutineTotal: number;
  dailyCheckedToday: number;
  dailyStreak: number;
  bestStreak: number;
  weeklyRoutineTotal: number;
  weeklyCheckedThisWeek: number;
  monthlyRoutineTotal: number;
  monthlyCheckedThisMonth: number;
  // Activity
  totalActivityEntries: number;
  // Computed
  taskCompletionRate: number;
  overallCompletionRate: number;
  // Weekly comparison
  thisWeekCompleted: number;
  lastWeekCompleted: number;
  thisWeekTracked: number;
  lastWeekTracked: number;
  // Most productive day
  productiveDayStats: { day: string; count: number }[];
  // Time per project (last 4 weeks)
  projectTimeStats: { title: string; color: string; seconds: number }[];
}

export default function StatsPage() {
  const { userId, loading: authLoading } = useCurrentUser();
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);

  useEffect(() => {
    setMonthlyEnabled(localStorage.getItem("comfy-monthly-routine") === "true");
  }, []);

  useEffect(() => {
    if (authLoading || !userId) return;

    const load = async () => {
      try {
        const supabase = createClient();
        const today = formatDate(new Date());
        const wKey = getWeekKey(new Date());
        const mKey = getMonthKey(new Date());

        // Projects
        const { count: totalProjects } = await supabase.from("projects").select("*", { count: "exact", head: true }).eq("user_id", userId).is("archived_at", null);
        const { count: archivedProjects } = await supabase.from("projects").select("*", { count: "exact", head: true }).eq("user_id", userId).not("archived_at", "is", null);

        // Tasks
        const { data: allTasks } = await supabase.from("project_tasks").select("progress, elapsed_seconds").eq("user_id", userId).is("archived_at", null);
        const totalTasks = allTasks?.length || 0;
        const completedTasks = (allTasks || []).filter((t) => t.progress >= 100).length;
        const taskTrackedSeconds = (allTasks || []).reduce((s, t) => s + (t.elapsed_seconds || 0), 0);

        // Subtasks
        const { data: allSubs } = await supabase.from("subtasks").select("progress, elapsed_seconds").eq("user_id", userId);
        const totalSubtasks = allSubs?.length || 0;
        const completedSubtasks = (allSubs || []).filter((s) => s.progress >= 100).length;
        const subtaskTrackedSeconds = (allSubs || []).reduce((s, t) => s + (t.elapsed_seconds || 0), 0);

        // Quick tasks completed (deleted = completed, so we count activity log)
        // We can't count deleted rows, so just show current count
        const { count: quickTasksCurrent } = await supabase.from("quick_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId);

        // Daily routine
        const { count: dailyRoutineTotal } = await supabase.from("routine_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId);
        const { count: dailyCheckedToday } = await supabase.from("routine_checks").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("checked_date", today);

        // Daily streak: count consecutive days with all tasks checked
        // Single query: fetch check counts per day for last year
        let dailyStreak = 0;
        let bestStreak = 0;
        if (dailyRoutineTotal && dailyRoutineTotal > 0) {
          const yearAgo = new Date();
          yearAgo.setDate(yearAgo.getDate() - 365);
          const { data: allChecks } = await supabase
            .from("routine_checks")
            .select("checked_date")
            .eq("user_id", userId)
            .gte("checked_date", formatDate(yearAgo));

          // Count checks per date
          const checkCounts: Record<string, number> = {};
          for (const c of allChecks || []) {
            checkCounts[c.checked_date] = (checkCounts[c.checked_date] || 0) + 1;
          }

          // Walk backwards from today to compute current streak
          const d = new Date();
          let skippedToday = false;
          for (let i = 0; i < 365; i++) {
            const dateStr = formatDate(d);
            if (checkCounts[dateStr] === dailyRoutineTotal) {
              dailyStreak++;
            } else if (i === 0) {
              skippedToday = true; // Today not complete yet, check yesterday
            } else {
              break;
            }
            d.setDate(d.getDate() - 1);
          }

          // Find best historical streak from the same data
          bestStreak = dailyStreak;
          let currentRun = 0;
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 365);
          for (let i = 0; i < 365; i++) {
            const dateStr = formatDate(startDate);
            if (checkCounts[dateStr] === dailyRoutineTotal) {
              currentRun++;
              if (currentRun > bestStreak) bestStreak = currentRun;
            } else {
              currentRun = 0;
            }
            startDate.setDate(startDate.getDate() + 1);
          }
        }

        // Weekly routine
        const { count: weeklyRoutineTotal } = await supabase.from("weekly_routine_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId);
        const { count: weeklyCheckedThisWeek } = await supabase.from("weekly_routine_checks").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("week_key", wKey);

        // Monthly routine
        let monthlyRoutineTotal = 0;
        let monthlyCheckedThisMonth = 0;
        if (monthlyEnabled) {
          const { count: mrt } = await supabase.from("monthly_routine_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId);
          monthlyRoutineTotal = mrt || 0;
          const { count: mrc } = await supabase.from("monthly_routine_checks").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("month_key", mKey);
          monthlyCheckedThisMonth = mrc || 0;
        }

        // Activity
        const { count: totalActivityEntries } = await supabase.from("activity_log").select("*", { count: "exact", head: true }).eq("user_id", userId);

        const totalTrackedSeconds = taskTrackedSeconds + subtaskTrackedSeconds;
        const totalItems = totalTasks + totalSubtasks;
        const completedItems = completedTasks + completedSubtasks;

        // --- Weekly comparison ---
        const thisMonday = getMonday(new Date());
        const lastMonday = addDays(thisMonday, -7);
        const thisWeekDates: string[] = [];
        const lastWeekDates: string[] = [];
        for (let i = 0; i < 7; i++) {
          thisWeekDates.push(formatDate(addDays(thisMonday, i)));
          lastWeekDates.push(formatDate(addDays(lastMonday, i)));
        }

        const { data: thisWeekTasks } = await supabase.from("week_tasks").select("done, date_key")
          .eq("user_id", userId).in("date_key", thisWeekDates);
        const { data: lastWeekTasks } = await supabase.from("week_tasks").select("done, date_key")
          .eq("user_id", userId).in("date_key", lastWeekDates);

        const thisWeekCompleted = (thisWeekTasks || []).filter((t) => t.done).length;
        const lastWeekCompleted = (lastWeekTasks || []).filter((t) => t.done).length;

        // Time tracked this week vs last (from activity log timestamps)
        const { data: thisWeekActivity } = await supabase.from("activity_log")
          .select("action, detail, created_at").eq("user_id", userId)
          .gte("created_at", thisMonday.toISOString()).like("action", "Timer stopped");
        const { data: lastWeekActivity } = await supabase.from("activity_log")
          .select("action, detail, created_at").eq("user_id", userId)
          .gte("created_at", lastMonday.toISOString()).lt("created_at", thisMonday.toISOString())
          .like("action", "Timer stopped");

        const parseTrackedTime = (entries: Array<{ detail: string }> | null): number => {
          let total = 0;
          for (const e of entries || []) {
            const match = e.detail?.match(/(\d+):(\d+):(\d+)/);
            if (match) total += parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
            const hMatch = e.detail?.match(/(\d+)h/);
            const mMatch = e.detail?.match(/(\d+)m/);
            const sMatch = e.detail?.match(/(\d+)s/);
            if (hMatch || mMatch || sMatch) {
              total += (parseInt(hMatch?.[1] || "0") * 3600) + (parseInt(mMatch?.[1] || "0") * 60) + parseInt(sMatch?.[1] || "0");
            }
          }
          return total;
        };
        const thisWeekTracked = parseTrackedTime(thisWeekActivity);
        const lastWeekTracked = parseTrackedTime(lastWeekActivity);

        // --- Most productive day of the week ---
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const { data: allChecks } = await supabase.from("routine_checks").select("checked_date").eq("user_id", userId);
        const dayCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        for (const c of allChecks || []) {
          const d = new Date(c.checked_date + "T00:00:00");
          dayCounts[d.getDay()]++;
        }
        // Also count week task completions
        const { data: allWeekDone } = await supabase.from("week_tasks").select("date_key").eq("user_id", userId).eq("done", true);
        for (const t of allWeekDone || []) {
          const d = new Date(t.date_key + "T00:00:00");
          dayCounts[d.getDay()]++;
        }
        const productiveDayStats = dayNames.map((name, i) => ({ day: name.slice(0, 3), count: dayCounts[i] }));

        // --- Time per project (all tracked time) ---
        const { data: projList } = await supabase.from("projects").select("id, title, color")
          .eq("user_id", userId).is("archived_at", null);
        const { data: recentTasks } = await supabase.from("project_tasks")
          .select("id, project_id, elapsed_seconds").eq("user_id", userId).is("archived_at", null);
        const { data: recentSubs } = await supabase.from("subtasks")
          .select("task_id, elapsed_seconds").eq("user_id", userId);

        const projTime: Record<string, number> = {};
        const taskIdToProj: Record<string, string> = {};
        for (const t of recentTasks || []) {
          taskIdToProj[t.id] = t.project_id;
          projTime[t.project_id] = (projTime[t.project_id] || 0) + (t.elapsed_seconds || 0);
        }
        for (const s of recentSubs || []) {
          const projId = taskIdToProj[s.task_id];
          if (projId) projTime[projId] = (projTime[projId] || 0) + (s.elapsed_seconds || 0);
        }

        const projMap: Record<string, { title: string; color: string }> = {};
        for (const p of projList || []) projMap[p.id] = { title: p.title, color: p.color || "#e05555" };

        const projectTimeStats = Object.entries(projTime)
          .filter(([, secs]) => secs > 0)
          .map(([id, secs]) => ({
            title: projMap[id]?.title || "Unknown",
            color: projMap[id]?.color || "#5c5a7a",
            seconds: secs,
          }))
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, 8);

        setStats({
          totalProjects: totalProjects || 0,
          archivedProjects: archivedProjects || 0,
          totalTasks,
          completedTasks,
          totalSubtasks,
          completedSubtasks,
          quickTasksCompleted: quickTasksCurrent || 0,
          totalTrackedSeconds,
          taskTrackedSeconds,
          subtaskTrackedSeconds,
          dailyRoutineTotal: dailyRoutineTotal || 0,
          dailyCheckedToday: dailyCheckedToday || 0,
          dailyStreak,
          bestStreak,
          weeklyRoutineTotal: weeklyRoutineTotal || 0,
          weeklyCheckedThisWeek: weeklyCheckedThisWeek || 0,
          monthlyRoutineTotal,
          monthlyCheckedThisMonth,
          totalActivityEntries: totalActivityEntries || 0,
          taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
          overallCompletionRate: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
          thisWeekCompleted,
          lastWeekCompleted,
          thisWeekTracked,
          lastWeekTracked,
          productiveDayStats,
          projectTimeStats,
        });
      } catch (err) {
        console.error("Stats load failed:", err);
        toast("Failed to load stats", "error");
      }
      setLoading(false);
    };
    load();
  }, [userId, authLoading, monthlyEnabled, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-violet border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats) return null;

  const s = stats;

  // Format hours
  const totalHours = Math.floor(s.totalTrackedSeconds / 3600);
  const totalMins = Math.floor((s.totalTrackedSeconds % 3600) / 60);

  // Streak badge
  const streakColor = s.dailyStreak >= 30 ? "#f59e0b" : s.dailyStreak >= 7 ? "#4ade80" : s.dailyStreak >= 3 ? "#7c6fff" : "#5c5a7a";

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="font-title text-2xl text-bright flex items-center gap-2"><PieChart size={22} /> Stats & Activity</h1>
        <p className="text-sm text-txt2 mt-0.5">Your productivity at a glance</p>
      </div>

      {/* Top highlight cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-green-acc mb-2"><CheckCircle size={18} /></div>
          <p className="text-2xl font-bold text-bright">{s.overallCompletionRate}%</p>
          <p className="text-[10px] text-txt3 uppercase tracking-wider mt-1">Completion Rate</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-violet2 mb-2"><Clock size={18} /></div>
          <p className="text-2xl font-bold text-bright">{totalHours}h {totalMins}m</p>
          <p className="text-[10px] text-txt3 uppercase tracking-wider mt-1">Total Tracked</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-2" style={{ color: streakColor }}><Flame size={18} /></div>
          <p className="text-2xl font-bold text-bright">{s.dailyStreak}</p>
          <p className="text-[10px] text-txt3 uppercase tracking-wider mt-1">Day Streak</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-red-acc mb-2"><Target size={18} /></div>
          <p className="text-2xl font-bold text-bright">{s.completedTasks + s.completedSubtasks}</p>
          <p className="text-[10px] text-txt3 uppercase tracking-wider mt-1">Tasks Done</p>
        </div>
      </div>

      {/* Projects & Tasks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-surface border border-border rounded-xl p-4">
          <h2 className="text-sm font-medium text-txt2 flex items-center gap-1.5 mb-4"><Folder size={15} /> Projects</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-txt3">Active projects</span>
              <span className="text-sm font-mono text-bright">{s.totalProjects}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-txt3">Archived</span>
              <span className="text-sm font-mono text-txt3">{s.archivedProjects}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-txt3">Total tasks</span>
              <span className="text-sm font-mono text-bright">{s.totalTasks}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-txt3">Completed tasks</span>
              <span className="text-sm font-mono text-green-acc">{s.completedTasks}</span>
            </div>
            <ProgressBar value={s.taskCompletionRate} height={6} showLabel label="Task completion" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-txt3">Total subtasks</span>
              <span className="text-sm font-mono text-bright">{s.totalSubtasks}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-txt3">Completed subtasks</span>
              <span className="text-sm font-mono text-green-acc">{s.completedSubtasks}</span>
            </div>
            {s.totalSubtasks > 0 && (
              <ProgressBar value={Math.round((s.completedSubtasks / s.totalSubtasks) * 100)} height={6} showLabel label="Subtask completion" />
            )}
          </div>
        </div>

        {/* Time tracking */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <h2 className="text-sm font-medium text-txt2 flex items-center gap-1.5 mb-4"><Clock size={15} /> Time Tracking</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-txt3">Total tracked</span>
              <span className="text-sm font-mono text-bright">{formatSeconds(s.totalTrackedSeconds)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-txt3">On tasks</span>
              <span className="text-sm font-mono text-txt2">{formatSeconds(s.taskTrackedSeconds)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-txt3">On subtasks</span>
              <span className="text-sm font-mono text-txt2">{formatSeconds(s.subtaskTrackedSeconds)}</span>
            </div>
            {s.totalTrackedSeconds > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-txt3 mb-1">Task vs Subtask time</p>
                <div className="flex h-3 rounded-full overflow-hidden bg-surface3">
                  <div className="bg-violet transition-all" style={{ width: `${(s.taskTrackedSeconds / s.totalTrackedSeconds) * 100}%` }} />
                  <div className="bg-red-acc transition-all" style={{ width: `${(s.subtaskTrackedSeconds / s.totalTrackedSeconds) * 100}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-violet2">Tasks {Math.round((s.taskTrackedSeconds / s.totalTrackedSeconds) * 100)}%</span>
                  <span className="text-[10px] text-red-acc">Subtasks {Math.round((s.subtaskTrackedSeconds / s.totalTrackedSeconds) * 100)}%</span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-xs text-txt3">Quick tasks active</span>
              <span className="text-sm font-mono text-txt2">{s.quickTasksCompleted}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-txt3">Activity log entries</span>
              <span className="text-sm font-mono text-txt3">{s.totalActivityEntries}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Routines */}
      <div className="bg-surface border border-border rounded-xl p-4 mb-4">
        <h2 className="text-sm font-medium text-txt2 flex items-center gap-1.5 mb-4"><Trophy size={15} /> Routine Streaks</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Daily */}
          <div className="bg-surface2 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-txt2 mb-2"><ListChecks size={13} /> Daily Routine</div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-txt3">Today</span>
              <span className="text-sm font-mono text-bright">{s.dailyCheckedToday}/{s.dailyRoutineTotal}</span>
            </div>
            {s.dailyRoutineTotal > 0 && <ProgressBar value={Math.round((s.dailyCheckedToday / s.dailyRoutineTotal) * 100)} height={4} />}
            <div className="flex items-center gap-1.5 mt-2">
              <Flame size={13} style={{ color: streakColor }} />
              <span className="text-xs font-mono" style={{ color: streakColor }}>{s.dailyStreak} day streak</span>
              {s.bestStreak > s.dailyStreak && (
                <span className="text-[10px] text-txt3 ml-1">· best: {s.bestStreak}</span>
              )}
            </div>
          </div>

          {/* Weekly */}
          <div className="bg-surface2 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-txt2 mb-2"><RefreshCw size={13} /> Weekly Routine</div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-txt3">This week</span>
              <span className="text-sm font-mono text-bright">{s.weeklyCheckedThisWeek}/{s.weeklyRoutineTotal}</span>
            </div>
            {s.weeklyRoutineTotal > 0 && <ProgressBar value={Math.round((s.weeklyCheckedThisWeek / s.weeklyRoutineTotal) * 100)} height={4} />}
          </div>

          {/* Monthly */}
          {monthlyEnabled && (
            <div className="bg-surface2 rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-txt2 mb-2"><CalendarRange size={13} /> Monthly Routine</div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-txt3">This month</span>
                <span className="text-sm font-mono text-bright">{s.monthlyCheckedThisMonth}/{s.monthlyRoutineTotal}</span>
              </div>
              {s.monthlyRoutineTotal > 0 && <ProgressBar value={Math.round((s.monthlyCheckedThisMonth / s.monthlyRoutineTotal) * 100)} height={4} />}
            </div>
          )}
        </div>
      </div>

      {/* Weekly comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-surface border border-border rounded-xl p-4">
          <h2 className="text-sm font-medium text-txt2 flex items-center gap-1.5 mb-4"><Calendar size={15} /> This Week vs Last Week</h2>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-txt3">Tasks completed</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-bright">{s.thisWeekCompleted}</span>
                  {s.thisWeekCompleted > s.lastWeekCompleted ? (
                    <span className="text-[10px] text-green-acc flex items-center gap-0.5"><TrendingUp size={11} /> +{s.thisWeekCompleted - s.lastWeekCompleted}</span>
                  ) : s.thisWeekCompleted < s.lastWeekCompleted ? (
                    <span className="text-[10px] text-danger flex items-center gap-0.5"><TrendingDown size={11} /> {s.thisWeekCompleted - s.lastWeekCompleted}</span>
                  ) : (
                    <span className="text-[10px] text-txt3 flex items-center gap-0.5"><Minus size={11} /> same</span>
                  )}
                </div>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden gap-1">
                <div className="bg-violet/30 rounded-full flex-1 overflow-hidden">
                  <div className="h-full bg-violet rounded-full transition-all" style={{
                    width: `${Math.max(s.thisWeekCompleted, s.lastWeekCompleted) > 0 ? (s.lastWeekCompleted / Math.max(s.thisWeekCompleted, s.lastWeekCompleted)) * 100 : 0}%`
                  }} />
                </div>
                <div className="bg-green-acc/30 rounded-full flex-1 overflow-hidden">
                  <div className="h-full bg-green-acc rounded-full transition-all" style={{
                    width: `${Math.max(s.thisWeekCompleted, s.lastWeekCompleted) > 0 ? (s.thisWeekCompleted / Math.max(s.thisWeekCompleted, s.lastWeekCompleted)) * 100 : 0}%`
                  }} />
                </div>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-violet2">Last: {s.lastWeekCompleted}</span>
                <span className="text-[10px] text-green-acc">This: {s.thisWeekCompleted}</span>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-txt3">Time tracked</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-bright">{formatSeconds(s.thisWeekTracked)}</span>
                  {s.thisWeekTracked > s.lastWeekTracked ? (
                    <span className="text-[10px] text-green-acc flex items-center gap-0.5"><TrendingUp size={11} /></span>
                  ) : s.thisWeekTracked < s.lastWeekTracked ? (
                    <span className="text-[10px] text-danger flex items-center gap-0.5"><TrendingDown size={11} /></span>
                  ) : (
                    <span className="text-[10px] text-txt3 flex items-center gap-0.5"><Minus size={11} /></span>
                  )}
                </div>
              </div>
              <div className="flex justify-between text-[10px] text-txt3">
                <span>Last week: {formatSeconds(s.lastWeekTracked)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Most productive day */}
        <div className="bg-surface border border-border rounded-xl p-4">
          <h2 className="text-sm font-medium text-txt2 flex items-center gap-1.5 mb-4"><BarChart3 size={15} /> Most Productive Day</h2>
          {(() => {
            const maxCount = Math.max(...s.productiveDayStats.map((d) => d.count), 1);
            const bestDay = s.productiveDayStats.reduce((best, d) => d.count > best.count ? d : best, s.productiveDayStats[0]);
            return (
              <div className="space-y-2">
                {s.productiveDayStats.map((d) => {
                  const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
                  const isBest = d.day === bestDay?.day && d.count > 0;
                  return (
                    <div key={d.day} className="flex items-center gap-3">
                      <span className={cn("text-xs w-8 font-mono", isBest ? "text-bright font-bold" : "text-txt3")}>{d.day}</span>
                      <div className="flex-1 h-3 bg-surface3 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", isBest ? "bg-green-acc" : "bg-violet/40")}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className={cn("text-xs font-mono w-8 text-right", isBest ? "text-green-acc" : "text-txt3")}>{d.count}</span>
                    </div>
                  );
                })}
                {bestDay && bestDay.count > 0 && (
                  <p className="text-[10px] text-txt3 mt-2">You&apos;re most active on <span className="text-green-acc font-medium">{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][s.productiveDayStats.indexOf(bestDay)]}s</span> based on completed tasks and routine checks</p>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Time per project */}
      {s.projectTimeStats.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-4 mb-4">
          <h2 className="text-sm font-medium text-txt2 flex items-center gap-1.5 mb-4"><Folder size={15} /> Time per Project</h2>
          {(() => {
            const maxSecs = Math.max(...s.projectTimeStats.map((p) => p.seconds), 1);
            const totalSecs = s.projectTimeStats.reduce((s, p) => s + p.seconds, 0);
            return (
              <div className="space-y-3">
                {/* Stacked bar */}
                <div className="flex h-4 rounded-full overflow-hidden">
                  {s.projectTimeStats.map((p) => (
                    <div key={p.title} className="transition-all" style={{
                      width: `${(p.seconds / totalSecs) * 100}%`,
                      backgroundColor: p.color,
                    }} title={`${p.title}: ${formatSeconds(p.seconds)}`} />
                  ))}
                </div>
                {/* Individual bars */}
                {s.projectTimeStats.map((p) => (
                  <div key={p.title} className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="text-xs truncate flex-1" style={{ color: p.color }}>{p.title}</span>
                    <div className="w-24 h-2 bg-surface3 rounded-full overflow-hidden shrink-0">
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${(p.seconds / maxSecs) * 100}%`,
                        backgroundColor: p.color,
                      }} />
                    </div>
                    <span className="text-xs font-mono text-txt3 w-16 text-right shrink-0">{formatSeconds(p.seconds)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
