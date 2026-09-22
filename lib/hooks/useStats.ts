"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { formatDate, getWeekKey, getMonthKey, getMonday, addDays } from "@/lib/utils";
import { isRecurrence } from "@/lib/recurrence";

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

  /**
   * Estimate vs actual.
   *
   * The app has always stored `est_minutes` on every task and subtask and
   * tracked real elapsed time against both — and never once compared them.
   * That comparison is the thing that makes re-running a similar project
   * possible: not just last time's raw hours, but your personal correction
   * factor.
   *
   * Only COMPLETED items count, since a half-finished task's elapsed time
   * says nothing about whether the estimate was good.
   */
  accuracy: {
    /** Completed items that had both an estimate and tracked time. */
    sampleSize: number;
    estimatedSeconds: number;
    actualSeconds: number;
    /** actual / estimated. 1.0 = spot on, 2.0 = took twice as long. */
    ratio: number | null;
    /** Per project, worst offender first. */
    byProject: {
      title: string; color: string;
      estimatedSeconds: number; actualSeconds: number;
      ratio: number; sampleSize: number;
    }[];
    /** Individual completed tasks with the biggest miss, either direction. */
    worstTasks: {
      name: string; projectTitle: string; color: string;
      estimatedSeconds: number; actualSeconds: number; ratio: number;
    }[];
  };
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

      const thisMonday = getMonday(new Date());
      const lastMonday = addDays(thisMonday, -7);
      const thisWeekDates: string[] = [];
      const lastWeekDates: string[] = [];
      for (let i = 0; i < 7; i++) {
        thisWeekDates.push(formatDate(addDays(thisMonday, i)));
        lastWeekDates.push(formatDate(addDays(lastMonday, i)));
      }
      const yearAgo = new Date();
      yearAgo.setDate(yearAgo.getDate() - 365);

      const [
        r_totalProjects,
        r_archivedProjects,
        r_allTasks,
        r_allSubs,
        r_quickTasks,
        r_dailyRoutineTotal,
        r_dailyCheckedToday,
        r_streakChecks,
        r_weeklyRoutineTotal,
        r_weeklyCheckedThisWeek,
        r_monthlyRoutineTotal,
        r_monthlyCheckedThisMonth,
        r_totalActivity,
        r_thisWeekTasks,
        r_lastWeekTasks,
        r_thisWeekActivity,
        r_lastWeekActivity,
        r_allDayChecks,
        r_allWeekDone,
        r_projList,
        r_recentTasks,
        r_recentSubs,
        r_accTasks,
        r_accSubs,
      ] = await Promise.all([
        supabase.from("projects").select("*", { count: "exact", head: true }).eq("user_id", userId).is("archived_at", null),
        supabase.from("projects").select("*", { count: "exact", head: true }).eq("user_id", userId).not("archived_at", "is", null),
        supabase.from("project_tasks").select("progress, elapsed_seconds, recurrence").eq("user_id", userId).is("archived_at", null),
        supabase.from("subtasks").select("progress, elapsed_seconds").eq("user_id", userId),
        supabase.from("quick_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("routine_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("routine_checks").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("checked_date", today),
        supabase.from("routine_checks").select("checked_date").eq("user_id", userId).gte("checked_date", formatDate(yearAgo)),
        supabase.from("weekly_routine_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("weekly_routine_checks").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("week_key", wKey),
        monthlyEnabled
          ? supabase.from("monthly_routine_tasks").select("*", { count: "exact", head: true }).eq("user_id", userId)
          : Promise.resolve({ count: 0 }),
        monthlyEnabled
          ? supabase.from("monthly_routine_checks").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("month_key", mKey)
          : Promise.resolve({ count: 0 }),
        supabase.from("activity_log").select("*", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("week_tasks").select("done, date_key").eq("user_id", userId).in("date_key", thisWeekDates),
        supabase.from("week_tasks").select("done, date_key").eq("user_id", userId).in("date_key", lastWeekDates),
        supabase.from("activity_log").select("action, detail, created_at").eq("user_id", userId).gte("created_at", thisMonday.toISOString()).like("action", "Timer stopped"),
        supabase.from("activity_log").select("action, detail, created_at").eq("user_id", userId).gte("created_at", lastMonday.toISOString()).lt("created_at", thisMonday.toISOString()).like("action", "Timer stopped"),
        supabase.from("routine_checks").select("checked_date").eq("user_id", userId),
        supabase.from("week_tasks").select("date_key").eq("user_id", userId).eq("done", true),
        supabase.from("projects").select("id, title, color").eq("user_id", userId).is("archived_at", null),
        supabase.from("project_tasks").select("id, project_id, elapsed_seconds").eq("user_id", userId).is("archived_at", null),
        supabase.from("subtasks").select("task_id, elapsed_seconds").eq("user_id", userId),
        supabase.from("project_tasks").select("id, name, project_id, est_minutes, elapsed_seconds, progress").eq("user_id", userId).is("archived_at", null).gte("progress", 100),
        supabase.from("subtasks").select("task_id, est_minutes, elapsed_seconds, progress").eq("user_id", userId),
      ]);

      // ── Process results ─────────────────────────────────────────────────

      const totalProjects = r_totalProjects.count || 0;
      const archivedProjects = r_archivedProjects.count || 0;

      const allTasks = r_allTasks.data || [];
      const countableTasks = allTasks.filter((t) => !isRecurrence(t.recurrence));
      const totalTasks = countableTasks.length;
      const completedTasks = countableTasks.filter((t) => t.progress >= 100).length;
      const taskTrackedSeconds = allTasks.reduce((s, t) => s + (t.elapsed_seconds || 0), 0);

      const allSubs = r_allSubs.data || [];
      const totalSubtasks = allSubs.length;
      const completedSubtasks = allSubs.filter((s) => s.progress >= 100).length;
      const subtaskTrackedSeconds = allSubs.reduce((s, t) => s + (t.elapsed_seconds || 0), 0);

      const quickTasksCompleted = r_quickTasks.count || 0;
      const dailyRoutineTotal = r_dailyRoutineTotal.count || 0;
      const dailyCheckedToday = r_dailyCheckedToday.count || 0;

      let dailyStreak = 0;
      let bestStreak = 0;
      if (dailyRoutineTotal > 0) {
        const checkCounts: Record<string, number> = {};
        for (const c of r_streakChecks.data || []) {
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

      const weeklyRoutineTotal = r_weeklyRoutineTotal.count || 0;
      const weeklyCheckedThisWeek = r_weeklyCheckedThisWeek.count || 0;
      const monthlyRoutineTotal = r_monthlyRoutineTotal.count || 0;
      const monthlyCheckedThisMonth = r_monthlyCheckedThisMonth.count || 0;
      const totalActivityEntries = r_totalActivity.count || 0;

      const totalTrackedSeconds = taskTrackedSeconds + subtaskTrackedSeconds;
      const totalItems = totalTasks + totalSubtasks;
      const completedItems = completedTasks + completedSubtasks;

      const thisWeekCompleted = (r_thisWeekTasks.data || []).filter((t) => t.done).length;
      const lastWeekCompleted = (r_lastWeekTasks.data || []).filter((t) => t.done).length;

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
      const thisWeekTracked = parseTrackedTime(r_thisWeekActivity.data);
      const lastWeekTracked = parseTrackedTime(r_lastWeekActivity.data);

      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      for (const c of r_allDayChecks.data || []) {
        const dd = new Date(c.checked_date + "T00:00:00");
        dayCounts[dd.getDay()]++;
      }
      for (const t of r_allWeekDone.data || []) {
        const dd = new Date(t.date_key + "T00:00:00");
        dayCounts[dd.getDay()]++;
      }
      const productiveDayStats = dayNames.map((name, i) => ({ day: name.slice(0, 3), count: dayCounts[i] }));

      const projTime: Record<string, number> = {};
      const taskIdToProj: Record<string, string> = {};
      for (const t of r_recentTasks.data || []) {
        taskIdToProj[t.id] = t.project_id;
        projTime[t.project_id] = (projTime[t.project_id] || 0) + (t.elapsed_seconds || 0);
      }
      for (const s of r_recentSubs.data || []) {
        const projId = taskIdToProj[s.task_id];
        if (projId) projTime[projId] = (projTime[projId] || 0) + (s.elapsed_seconds || 0);
      }

      const projMap: Record<string, { title: string; color: string }> = {};
      for (const p of r_projList.data || []) projMap[p.id] = { title: p.title, color: p.color || "#e05555" };

      const projectTimeStats = Object.entries(projTime)
        .filter(([, secs]) => secs > 0)
        .map(([id, secs]) => ({
          title: projMap[id]?.title || "Unknown",
          color: projMap[id]?.color || "#5c5a7a",
          seconds: secs,
        }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 8);

      const accTasks = r_accTasks.data || [];
      const accSubs = r_accSubs.data || [];

      const subsByTask: Record<string, { est: number; elapsed: number; count: number }> = {};
      for (const sub of accSubs) {
        const bucket = subsByTask[sub.task_id] ||= { est: 0, elapsed: 0, count: 0 };
        bucket.est += (sub.est_minutes || 0) * 60;
        bucket.elapsed += sub.elapsed_seconds || 0;
        bucket.count += 1;
      }

      let estTotal = 0, actTotal = 0, sampleSize = 0;
      const perProject: Record<string, { est: number; act: number; n: number }> = {};
      const taskRows: Stats["accuracy"]["worstTasks"] = [];

      for (const t of accTasks) {
        const children = subsByTask[t.id];
        const estSeconds = (t.est_minutes || 0) * 60;
        const actSeconds = (t.elapsed_seconds || 0) + (children?.elapsed ?? 0);

        // Needs both sides to say anything useful.
        if (estSeconds <= 0 || actSeconds <= 0) continue;

        estTotal += estSeconds;
        actTotal += actSeconds;
        sampleSize += 1;

        const bucket = perProject[t.project_id] ||= { est: 0, act: 0, n: 0 };
        bucket.est += estSeconds;
        bucket.act += actSeconds;
        bucket.n += 1;

        taskRows.push({
          name: t.name,
          projectTitle: projMap[t.project_id]?.title || "Unknown",
          color: projMap[t.project_id]?.color || "#5c5a7a",
          estimatedSeconds: estSeconds,
          actualSeconds: actSeconds,
          ratio: actSeconds / estSeconds,
        });
      }

      const accuracy: Stats["accuracy"] = {
        sampleSize,
        estimatedSeconds: estTotal,
        actualSeconds: actTotal,
        ratio: estTotal > 0 ? actTotal / estTotal : null,
        byProject: Object.entries(perProject)
          .map(([id, v]) => ({
            title: projMap[id]?.title || "Unknown",
            color: projMap[id]?.color || "#5c5a7a",
            estimatedSeconds: v.est, actualSeconds: v.act,
            ratio: v.act / v.est, sampleSize: v.n,
          }))
          .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1)),
        // Biggest miss in either direction — over- and under-estimating are
        // both worth seeing.
        worstTasks: taskRows
          .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1))
          .slice(0, 6),
      };

      setStats({
        totalProjects: totalProjects || 0,
        archivedProjects: archivedProjects || 0,
        totalTasks, completedTasks, totalSubtasks, completedSubtasks,
        quickTasksCompleted: quickTasksCompleted,
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
        productiveDayStats, projectTimeStats, accuracy,
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
