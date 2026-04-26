"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { formatDate, getWeekKey, getMonthKey, getMonday, addDays } from "@/lib/utils";

export interface Stats {
  totalProjects: number;
  archivedProjects: number;
  totalTasks: number;
  completedTasks: number;
  totalSubtasks: number;
  completedSubtasks: number;
  quickTasksCompleted: number;
  totalTrackedSeconds: number;
  taskTrackedSeconds: number;
  subtaskTrackedSeconds: number;
  dailyRoutineTotal: number;
  dailyCheckedToday: number;
  dailyStreak: number;
  bestStreak: number;
  weeklyRoutineTotal: number;
  weeklyCheckedThisWeek: number;
  monthlyRoutineTotal: number;
  monthlyCheckedThisMonth: number;
  totalActivityEntries: number;
  taskCompletionRate: number;
  overallCompletionRate: number;
  thisWeekCompleted: number;
  lastWeekCompleted: number;
  thisWeekTracked: number;
  lastWeekTracked: number;
  productiveDayStats: { day: string; count: number }[];
  projectTimeStats: { title: string; color: string; seconds: number }[];
}

export function useStats(userId: string | null, authLoading: boolean, monthlyEnabled: boolean) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

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

      const { count: quickTasksCurrent } = await supabase.from("quick_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId);

      // Daily routine
      const { count: dailyRoutineTotal } = await supabase.from("routine_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId);
      const { count: dailyCheckedToday } = await supabase.from("routine_checks").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("checked_date", today);

      // Daily streak (bulk fetch)
      let dailyStreak = 0;
      let bestStreak = 0;
      if (dailyRoutineTotal && dailyRoutineTotal > 0) {
        const yearAgo = new Date();
        yearAgo.setDate(yearAgo.getDate() - 365);
        const { data: streakChecks } = await supabase
          .from("routine_checks").select("checked_date")
          .eq("user_id", userId).gte("checked_date", formatDate(yearAgo));

        const checkCounts: Record<string, number> = {};
        for (const c of streakChecks || []) {
          checkCounts[c.checked_date] = (checkCounts[c.checked_date] || 0) + 1;
        }

        const d = new Date();
        for (let i = 0; i < 365; i++) {
          const dateStr = formatDate(d);
          if (checkCounts[dateStr] === dailyRoutineTotal) {
            dailyStreak++;
          } else if (i === 0) {
            // Today not complete yet
          } else {
            break;
          }
          d.setDate(d.getDate() - 1);
        }

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

      // Weekly comparison
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

      // Time tracked this vs last week
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

      // Most productive day
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const { data: allDayChecks } = await supabase.from("routine_checks").select("checked_date").eq("user_id", userId);
      const dayCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      for (const c of allDayChecks || []) {
        const dd = new Date(c.checked_date + "T00:00:00");
        dayCounts[dd.getDay()]++;
      }
      const { data: allWeekDone } = await supabase.from("week_tasks").select("date_key").eq("user_id", userId).eq("done", true);
      for (const t of allWeekDone || []) {
        const dd = new Date(t.date_key + "T00:00:00");
        dayCounts[dd.getDay()]++;
      }
      const productiveDayStats = dayNames.map((name, i) => ({ day: name.slice(0, 3), count: dayCounts[i] }));

      // Time per project
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
        totalTasks, completedTasks, totalSubtasks, completedSubtasks,
        quickTasksCompleted: quickTasksCurrent || 0,
        totalTrackedSeconds, taskTrackedSeconds, subtaskTrackedSeconds,
        dailyRoutineTotal: dailyRoutineTotal || 0,
        dailyCheckedToday: dailyCheckedToday || 0,
        dailyStreak, bestStreak,
        weeklyRoutineTotal: weeklyRoutineTotal || 0,
        weeklyCheckedThisWeek: weeklyCheckedThisWeek || 0,
        monthlyRoutineTotal, monthlyCheckedThisMonth,
        totalActivityEntries: totalActivityEntries || 0,
        taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        overallCompletionRate: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
        thisWeekCompleted, lastWeekCompleted,
        thisWeekTracked, lastWeekTracked,
        productiveDayStats, projectTimeStats,
      });
    } catch (err) {
      console.error("Stats load failed:", err);
      setError("Failed to load stats");
    }
    setLoading(false);
  }, [userId, monthlyEnabled]);

  useEffect(() => {
    if (!authLoading && userId) load();
  }, [authLoading, userId, load]);

  return { stats, loading, error };
}
