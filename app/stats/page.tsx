"use client";

import { useEffect, useState, useCallback } from "react";
import { formatSeconds, cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { useToast } from "@/components/Toast";
import { useStats } from "@/lib/hooks/useStats";
import { createClient } from "@/lib/supabase";
import {
  PieChart, CheckCircle, Clock, Target, Flame, Trophy,
  ListChecks, RefreshCw, CalendarRange, Folder, ClipboardList,
  TrendingUp, TrendingDown, Minus, Calendar, BarChart3,
  ChevronLeft, ChevronRight, Download,
} from "lucide-react";

// ─── Weekly Time Summary ─────────────────────────────────────
function getWeekRange(offset: number) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const label = `${monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — ${sunday.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  return { start: fmt(monday), end: fmt(sunday), label };
}

interface WeekLog { project_title: string; project_color: string; seconds: number; tasks: Record<string, number>; }

function WeeklyTimeSummary({ userId }: { userId: string }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [logs, setLogs] = useState<WeekLog[]>([]);
  const [totalSec, setTotalSec] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = getWeekRange(weekOffset);
    const supabase = createClient();

    const { data } = await supabase
      .from("time_logs")
      .select("project_id, task_id, subtask_id, duration_seconds, date_key")
      .eq("user_id", userId)
      .gte("date_key", start)
      .lte("date_key", end)
      .order("date_key");

    if (!data || data.length === 0) { setLogs([]); setTotalSec(0); setLoading(false); return; }

    // Get project names + colors
    const pIds = [...new Set(data.map(d => d.project_id).filter(Boolean))];
    const { data: projects } = await supabase.from("projects").select("id, title, color").in("id", pIds);
    const pMap: Record<string, { title: string; color: string }> = {};
    for (const p of projects || []) pMap[p.id] = { title: p.title, color: p.color || "#7c6fff" };

    // Get task names
    const tIds = [...new Set(data.map(d => d.task_id).filter(Boolean))];
    const { data: taskData } = tIds.length > 0
      ? await supabase.from("project_tasks").select("id, name").in("id", tIds)
      : { data: [] };
    const tMap: Record<string, string> = {};
    for (const t of taskData || []) tMap[t.id] = t.name;

    // Group by project
    const byProject: Record<string, WeekLog> = {};
    let total = 0;
    for (const row of data) {
      const pid = row.project_id || "unknown";
      if (!byProject[pid]) {
        const p = pMap[pid] || { title: "Unknown", color: "#5c5a7a" };
        byProject[pid] = { project_title: p.title, project_color: p.color, seconds: 0, tasks: {} };
      }
      byProject[pid].seconds += row.duration_seconds;
      total += row.duration_seconds;

      const taskName = tMap[row.task_id] || "Untitled";
      byProject[pid].tasks[taskName] = (byProject[pid].tasks[taskName] || 0) + row.duration_seconds;
    }

    setLogs(Object.values(byProject).sort((a, b) => b.seconds - a.seconds));
    setTotalSec(total);
    setLoading(false);
  }, [userId, weekOffset]);

  useEffect(() => { load(); }, [load]);

  const { label } = getWeekRange(weekOffset);
  const isThisWeek = weekOffset === 0;

  const exportCSV = () => {
    const { start, end } = getWeekRange(weekOffset);
    let csv = "Project,Task,Hours,Minutes,Seconds\n";
    for (const log of logs) {
      for (const [task, sec] of Object.entries(log.tasks)) {
        csv += `"${log.project_title}","${task}",${Math.floor(sec / 3600)},${Math.floor((sec % 3600) / 60)},${sec % 60}\n`;
      }
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `time-log-${start}-to-${end}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-4 mb-6 card-float">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-violet2" />
          <h3 className="text-sm font-semibold text-bright">Weekly Time</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setWeekOffset(w => w - 1)} className="w-6 h-6 rounded flex items-center justify-center text-txt3 hover:text-txt hover:bg-surface3"><ChevronLeft size={14} /></button>
          <span className="text-xs text-txt2 min-w-[160px] text-center">{label}</span>
          <button onClick={() => setWeekOffset(w => w + 1)} disabled={isThisWeek} className="w-6 h-6 rounded flex items-center justify-center text-txt3 hover:text-txt hover:bg-surface3 disabled:opacity-30"><ChevronRight size={14} /></button>
          {logs.length > 0 && (
            <button onClick={exportCSV} title="Export CSV" className="w-6 h-6 rounded flex items-center justify-center text-txt3 hover:text-txt hover:bg-surface3 ml-1"><Download size={13} /></button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-6 text-txt3 text-xs">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-txt3 text-xs">No time tracked this week</p>
          <p className="text-[10px] text-txt3 mt-1">Timer sessions are logged automatically when you stop a timer</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl font-bold text-bright">{formatSeconds(totalSec)}</span>
            <span className="text-xs text-txt3">total</span>
          </div>
          {logs.map(log => {
            const pct = totalSec > 0 ? (log.seconds / totalSec) * 100 : 0;
            return (
              <div key={log.project_title}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: log.project_color }} />
                  <span className="text-xs font-medium flex-1 truncate" style={{ color: log.project_color }}>{log.project_title}</span>
                  <span className="text-xs font-mono text-txt3">{formatSeconds(log.seconds)}</span>
                  <span className="text-[10px] text-txt3 w-10 text-right">{Math.round(pct)}%</span>
                </div>
                <div className="w-full h-1.5 bg-surface3 rounded-full overflow-hidden ml-4 mb-1" style={{ width: "calc(100% - 16px)" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: log.project_color }} />
                </div>
                {Object.entries(log.tasks).length > 1 && (
                  <div className="ml-5 space-y-0.5">
                    {Object.entries(log.tasks).sort((a, b) => b[1] - a[1]).map(([task, sec]) => (
                      <div key={task} className="flex items-center gap-2 text-[10px] text-txt3">
                        <span className="truncate flex-1">{task}</span>
                        <span className="font-mono">{formatSeconds(sec)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function StatsPage() {
  const { userId, loading: authLoading } = useCurrentUser();
  const { toast } = useToast();
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);

  useEffect(() => { document.title = "Comfy Board — Stats"; }, []);
  useEffect(() => { setMonthlyEnabled(localStorage.getItem("comfy-monthly-routine") === "true"); }, []);

  const { stats, loading, error } = useStats(userId, authLoading, monthlyEnabled);

  useEffect(() => { if (error) toast(error, "error"); }, [error, toast]);

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
        <div className="bg-surface border border-border rounded-xl p-4 text-center card-float">
          <div className="flex items-center justify-center gap-1.5 text-green-acc mb-2"><CheckCircle size={18} /></div>
          <p className="text-2xl font-bold text-bright">{s.overallCompletionRate}%</p>
          <p className="text-[10px] text-txt3 uppercase tracking-wider mt-1">Completion Rate</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center card-float">
          <div className="flex items-center justify-center gap-1.5 text-muted-acc2 mb-2"><Clock size={18} /></div>
          <p className="text-2xl font-bold text-bright">{totalHours}h {totalMins}m</p>
          <p className="text-[10px] text-txt3 uppercase tracking-wider mt-1">Total Tracked</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center card-float">
          <div className="flex items-center justify-center gap-1.5 mb-2" style={{ color: streakColor }}><Flame size={18} /></div>
          <p className="text-2xl font-bold text-bright">{s.dailyStreak}</p>
          <p className="text-[10px] text-txt3 uppercase tracking-wider mt-1">Day Streak</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4 text-center card-float">
          <div className="flex items-center justify-center gap-1.5 text-red-acc mb-2"><Target size={18} /></div>
          <p className="text-2xl font-bold text-bright">{s.completedTasks + s.completedSubtasks}</p>
          <p className="text-[10px] text-txt3 uppercase tracking-wider mt-1">Tasks Done</p>
        </div>
      </div>

      {/* Weekly Time Summary */}
      <WeeklyTimeSummary userId={userId!} />

      {/* Projects & Tasks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-surface border border-border rounded-xl p-4 card-float">
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
        <div className="bg-surface border border-border rounded-xl p-4 card-float">
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
                  <div className="bg-muted-acc transition-all" style={{ width: `${(s.taskTrackedSeconds / s.totalTrackedSeconds) * 100}%` }} />
                  <div className="bg-red-acc transition-all" style={{ width: `${(s.subtaskTrackedSeconds / s.totalTrackedSeconds) * 100}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-muted-acc2">Tasks {Math.round((s.taskTrackedSeconds / s.totalTrackedSeconds) * 100)}%</span>
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
      <div className="bg-surface border border-border rounded-xl p-4 mb-4 card-float">
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
        <div className="bg-surface border border-border rounded-xl p-4 card-float">
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
                <div className="bg-muted-acc/30 rounded-full flex-1 overflow-hidden">
                  <div className="h-full bg-muted-acc rounded-full transition-all" style={{
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
                <span className="text-[10px] text-muted-acc2">Last: {s.lastWeekCompleted}</span>
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
        <div className="bg-surface border border-border rounded-xl p-4 card-float">
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
                        <div className={cn("h-full rounded-full transition-all", isBest ? "bg-green-acc" : "bg-muted-acc/40")}
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
        <div className="bg-surface border border-border rounded-xl p-4 mb-4 card-float">
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
