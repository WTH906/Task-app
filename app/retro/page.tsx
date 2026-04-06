"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { Project, ProjectTask } from "@/lib/types";
import { progressColor, cn, toLocalDateStr, formatMinutes } from "@/lib/utils";
import { ProgressBar } from "@/components/ProgressBar";

export default function RetroPlanningPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState("");

  const selectProject = (id: string | null) => {
    setSelectedProject(id);
    if (id) localStorage.setItem("retro_project", id);
  };

  const today = toLocalDateStr(new Date());

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data } = await supabase.from("projects").select("*").eq("user_id", user.id).order("sort_order");
      setProjects(data || []);
      const saved = localStorage.getItem("retro_project");
      if (saved && (data || []).some((p: Project) => p.id === saved)) {
        setSelectedProject(saved);
      }
    };
    load();
  }, []);

  const loadProject = useCallback(async (projectId: string) => {
    setLoading(true);
    const supabase = createClient();
    const { data: taskData } = await supabase
      .from("project_tasks").select("*").eq("project_id", projectId).order("sort_order");

    const tasksWithSubs: ProjectTask[] = [];
    for (const t of taskData || []) {
      const { data: subs } = await supabase
        .from("subtasks").select("*").eq("task_id", t.id).order("sort_order");
      tasksWithSubs.push({ ...t, subtasks: subs || [] });
    }
    setTasks(tasksWithSubs);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedProject) loadProject(selectedProject);
    else setTasks([]);
  }, [selectedProject, loadProject]);

  const project = projects.find((p) => p.id === selectedProject);

  // Calculate timeline range
  const allDates: string[] = [];
  for (const t of tasks) {
    if (t.deadline) allDates.push(t.deadline);
    for (const s of t.subtasks || []) {
      if (s.deadline) allDates.push(s.deadline);
    }
  }
  if (project?.deadline) allDates.push(project.deadline);
  allDates.push(today);

  const sortedDates = allDates.sort();
  const minDate = sortedDates.length > 0 ? sortedDates[0] : today;
  const maxDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : today;

  // Add buffer
  const startDate = new Date(minDate + "T00:00:00");
  startDate.setDate(startDate.getDate() - 3);
  const endDate = new Date(maxDate + "T00:00:00");
  endDate.setDate(endDate.getDate() + 7);

  const totalDays = Math.max(14, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

  const dateToPos = (d: string) => {
    const dayDiff = (new Date(d + "T00:00:00").getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    return (dayDiff / totalDays) * 100;
  };

  const todayPos = dateToPos(today);

  // Generate month markers
  const months: Array<{ label: string; pos: number }> = [];
  const cursor = new Date(startDate);
  cursor.setDate(1);
  if (cursor < startDate) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor <= endDate) {
    const dateStr = toLocalDateStr(cursor);
    months.push({
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      pos: dateToPos(dateStr),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Week markers
  const weeks: number[] = [];
  const wCursor = new Date(startDate);
  const dow = wCursor.getDay();
  wCursor.setDate(wCursor.getDate() + (dow === 0 ? 0 : 7 - dow));
  while (wCursor <= endDate) {
    weeks.push(dateToPos(toLocalDateStr(wCursor)));
    wCursor.setDate(wCursor.getDate() + 7);
  }

  // Stats
  const totalTasks = tasks.length;
  const withDeadline = tasks.filter((t) => t.deadline).length;
  const avgProgress = totalTasks > 0 ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / totalTasks) : 0;

  return (
    <div className="p-4 md:p-6 flex flex-col h-[calc(100vh-0px)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="font-title text-2xl text-bright">Retro Planning</h1>
          <p className="text-sm text-txt2 mt-0.5">Timeline view of project tasks and deadlines</p>
        </div>
        <select value={selectedProject || ""} onChange={(e) => selectProject(e.target.value || null)}
          className="bg-surface border border-border rounded-lg px-4 py-2 text-sm text-txt min-w-[200px]">
          <option value="">Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.title}{p.deadline ? ` (due ${p.deadline})` : ""}</option>
          ))}
        </select>
      </div>

      {!selectedProject && (
        <div className="flex-1 flex items-center justify-center text-txt3">
          <div className="text-center">
            <p className="text-4xl mb-3">📊</p>
            <p className="text-lg mb-1">Select a project</p>
            <p className="text-sm">Choose a project from the dropdown to view its timeline</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-violet border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {selectedProject && !loading && project && (
        <>
          {/* Project stats bar */}
          <div className="flex flex-wrap items-center gap-4 mb-4 bg-surface border border-border rounded-lg px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color || "#e05555" }} />
              <span className="text-bright font-medium">{project.title}</span>
            </div>
            <div className="w-px h-4 bg-border" />
            <span className="text-txt3">{totalTasks} tasks</span>
            <span className="text-txt3">{withDeadline} with deadlines</span>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <span className="text-txt3">Progress:</span>
              <ProgressBar value={avgProgress} height={6} />
              <span className="text-xs font-mono" style={{ color: progressColor(avgProgress) }}>{avgProgress}%</span>
            </div>
            {project.deadline && (
              <>
                <div className="w-px h-4 bg-border" />
                <span className="text-txt3">Deadline:</span>
                <span className="text-bright font-mono">{project.deadline}</span>
              </>
            )}
          </div>

          {/* Timeline */}
          <div className="flex-1 min-h-0 bg-surface border border-border rounded-xl overflow-hidden flex flex-col">
            {/* Timeline header */}
            <div className="relative h-10 border-b border-border bg-surface2 shrink-0 overflow-hidden">
              {months.map((m, i) => (
                <div key={i} className="absolute top-0 h-full border-l border-border2 flex items-center px-2"
                  style={{ left: `${m.pos}%` }}>
                  <span className="text-[10px] text-txt3 font-medium whitespace-nowrap">{m.label}</span>
                </div>
              ))}
              {/* Today marker */}
              <div className="absolute top-0 h-full w-px bg-violet z-10" style={{ left: `${todayPos}%` }}>
                <span className="absolute -top-0 left-1 text-[9px] text-violet2 font-mono whitespace-nowrap bg-surface2 px-1 rounded">TODAY</span>
              </div>
            </div>

            {/* Task rows */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {tasks.length === 0 && (
                <div className="text-center py-12 text-txt3 text-sm">No tasks in this project yet</div>
              )}

              {tasks.map((task) => {
                const hasDeadline = !!task.deadline;
                const taskPos = hasDeadline ? dateToPos(task.deadline!) : null;
                const todayP = dateToPos(today);

                return (
                  <div key={task.id}>
                    {/* Main task row */}
                    <div className="relative h-14 border-b border-border/50 group hover:bg-surface2/30 transition-colors">
                      {/* Week grid lines */}
                      {weeks.map((w, i) => (
                        <div key={i} className="absolute top-0 h-full border-l border-border/30" style={{ left: `${w}%` }} />
                      ))}

                      {/* Today line */}
                      <div className="absolute top-0 h-full w-px bg-violet/30 z-[1]" style={{ left: `${todayPos}%` }} />

                      {/* Project deadline marker */}
                      {project.deadline && (
                        <div className="absolute top-0 h-full w-px bg-danger/40 z-[1]" style={{ left: `${dateToPos(project.deadline)}%` }} />
                      )}

                      {/* Task bar */}
                      {hasDeadline && (
                        <div className="absolute top-2 h-5 rounded-full flex items-center px-2 z-[2] min-w-[8px]"
                          style={{
                            left: `${Math.min(taskPos!, todayP)}%`,
                            width: `${Math.abs(taskPos! - todayP)}%`,
                            backgroundColor: `${progressColor(task.progress)}30`,
                            borderLeft: `3px solid ${progressColor(task.progress)}`,
                          }}>
                        </div>
                      )}

                      {/* Deadline dot */}
                      {hasDeadline && (
                        <div className="absolute top-3 w-3 h-3 rounded-full z-[3] border-2 border-surface"
                          style={{ left: `${taskPos!}%`, marginLeft: -6, backgroundColor: progressColor(task.progress) }}
                          title={`${task.name}: ${task.deadline}`} />
                      )}

                      {/* Label */}
                      <div className="absolute left-2 top-0 h-full flex items-center z-[4] pointer-events-none">
                        <div className="bg-surface/90 backdrop-blur-sm rounded px-2 py-0.5 flex items-center gap-2 max-w-[250px]">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: progressColor(task.progress) }} />
                          <span className="text-xs text-bright truncate font-medium">{task.name}</span>
                          {task.est_minutes > 0 && <span className="text-[10px] text-txt3 font-mono shrink-0">{formatMinutes(task.est_minutes)}</span>}
                          <span className="text-[10px] font-mono shrink-0" style={{ color: progressColor(task.progress) }}>{task.progress}%</span>
                        </div>
                      </div>

                      {/* Date on the right */}
                      {hasDeadline && (
                        <div className="absolute right-2 top-0 h-full flex items-center z-[4] pointer-events-none">
                          <span className="text-[10px] text-txt3 font-mono bg-surface/90 px-1 rounded">{task.deadline}</span>
                        </div>
                      )}
                    </div>

                    {/* Subtask rows */}
                    {(task.subtasks || []).map((sub) => {
                      const subHasDeadline = !!sub.deadline;
                      const subPos = subHasDeadline ? dateToPos(sub.deadline!) : null;

                      return (
                        <div key={sub.id} className="relative h-10 border-b border-border/30 bg-surface2/20">
                          {weeks.map((w, i) => (
                            <div key={i} className="absolute top-0 h-full border-l border-border/20" style={{ left: `${w}%` }} />
                          ))}
                          <div className="absolute top-0 h-full w-px bg-violet/20 z-[1]" style={{ left: `${todayPos}%` }} />

                          {subHasDeadline && (
                            <div className="absolute top-2.5 w-2 h-2 rounded-full z-[3]"
                              style={{ left: `${subPos!}%`, marginLeft: -4, backgroundColor: progressColor(sub.progress) }}
                              title={`${sub.name}: ${sub.deadline}`} />
                          )}

                          <div className="absolute left-6 top-0 h-full flex items-center z-[4] pointer-events-none">
                            <div className="flex items-center gap-2 max-w-[220px]">
                              <span className="text-[10px] text-violet2">↳</span>
                              <span className="text-[11px] text-txt2 truncate">{sub.name}</span>
                              <span className="text-[10px] font-mono" style={{ color: progressColor(sub.progress) }}>{sub.progress}%</span>
                            </div>
                          </div>

                          {subHasDeadline && (
                            <div className="absolute right-2 top-0 h-full flex items-center z-[4] pointer-events-none">
                              <span className="text-[10px] text-txt3 font-mono">{sub.deadline}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Project deadline final marker */}
              {project.deadline && (
                <div className="relative h-10 border-b border-border bg-danger/5">
                  <div className="absolute top-0 h-full w-px bg-danger z-[1]" style={{ left: `${dateToPos(project.deadline)}%` }} />
                  <div className="absolute left-2 top-0 h-full flex items-center z-[4]">
                    <span className="text-xs text-danger font-medium bg-surface/90 px-2 py-0.5 rounded">
                      🏁 Project Deadline: {project.deadline}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mt-3 text-[10px] text-txt3">
            <div className="flex items-center gap-1"><div className="w-3 h-px bg-violet" /> Today</div>
            {project.deadline && <div className="flex items-center gap-1"><div className="w-3 h-px bg-danger" /> Project deadline</div>}
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-acc" /> 0-20%</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#e88833" }} /> 21-40%</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#d4c03a" }} /> 41-60%</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#7bc47b" }} /> 61-80%</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#2e8b2e" }} /> 81-100%</div>
          </div>
        </>
      )}
    </div>
  );
}
