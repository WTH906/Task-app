"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { Project, ProjectTask, Subtask } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RoadmapCheck {
  text: string;
  subtask_id: string | null;
}

interface Milestone {
  id: string;
  title: string;
  date_label: string;
  description: string;
  status: "future" | "active" | "done";
  project_task_id: string | null;
  checks: RoadmapCheck[];
}

interface Phase {
  name: string;
  milestones: Milestone[];
}

const STATUS_LABELS: Record<string, string> = { future: "upcoming", active: "in progress", done: "done" };
const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  future: { bg: "bg-surface3", text: "text-txt3", border: "border-border", dot: "bg-surface border-border2" },
  active: { bg: "bg-violet/10", text: "text-violet2", border: "border-violet/30", dot: "bg-violet border-violet" },
  done: { bg: "bg-green-acc/10", text: "text-green-acc", border: "border-green-acc/30", dot: "bg-green-acc border-green-acc" },
};

function genId() { return crypto.randomUUID(); }

export default function RoadmapPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const [dragMilestone, setDragMilestone] = useState<{ pi: number; mi: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data } = await supabase.from("projects").select("*").eq("user_id", user.id).order("sort_order");
      setProjects(data || []);
    };
    load();
  }, []);

  const loadRoadmap = useCallback(async (projectId: string) => {
    setLoading(true);
    const supabase = createClient();

    // Load roadmap data
    const { data: rd } = await supabase.from("roadmap_data")
      .select("*").eq("user_id", userId).eq("project_id", projectId).maybeSingle();
    setPhases(rd?.phases || []);

    // Load project tasks + subtasks for the picker
    const { data: tasks } = await supabase.from("project_tasks")
      .select("*").eq("project_id", projectId).order("sort_order");
    const tasksWithSubs: ProjectTask[] = [];
    for (const t of tasks || []) {
      const { data: subs } = await supabase.from("subtasks").select("*").eq("task_id", t.id).order("sort_order");
      tasksWithSubs.push({ ...t, subtasks: subs || [] });
    }
    setProjectTasks(tasksWithSubs);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (selectedProject && userId) loadRoadmap(selectedProject);
    else { setPhases([]); setProjectTasks([]); }
  }, [selectedProject, userId, loadRoadmap]);

  // Debounced save
  const savePhases = (newPhases: Phase[]) => {
    setPhases(newPhases);
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!selectedProject) return;
      const supabase = createClient();
      await supabase.from("roadmap_data").upsert({
        user_id: userId,
        project_id: selectedProject,
        phases: newPhases,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,project_id" });
      setSaving(false);
    }, 600);
  };

  const project = projects.find((p) => p.id === selectedProject);

  // Phase actions
  const addPhase = () => {
    savePhases([...phases, { name: "New phase", milestones: [] }]);
  };

  const updatePhase = (pi: number, name: string) => {
    const p = [...phases];
    p[pi] = { ...p[pi], name };
    savePhases(p);
  };

  const deletePhase = (pi: number) => {
    if (!confirm("Delete this phase?")) return;
    savePhases(phases.filter((_, i) => i !== pi));
  };

  // Milestone actions
  const addMilestone = (pi: number) => {
    const p = [...phases];
    p[pi].milestones.push({
      id: genId(), title: "", date_label: "", description: "",
      status: "future", project_task_id: null, checks: [],
    });
    savePhases(p);
  };

  const updateMilestone = (pi: number, mi: number, field: keyof Milestone, value: string) => {
    const p = [...phases];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p[pi].milestones[mi] as any)[field] = value;
    savePhases(p);
  };

  const deleteMilestone = (pi: number, mi: number) => {
    const p = [...phases];
    p[pi].milestones.splice(mi, 1);
    savePhases(p);
  };

  const cycleStatus = (pi: number, mi: number) => {
    const order: Array<"future" | "active" | "done"> = ["future", "active", "done"];
    const p = [...phases];
    const cur = p[pi].milestones[mi].status;
    p[pi].milestones[mi].status = order[(order.indexOf(cur) + 1) % 3];
    savePhases(p);
  };

  const linkTaskToMilestone = (pi: number, mi: number, taskId: string | null) => {
    const p = [...phases];
    const ms = p[pi].milestones[mi];
    ms.project_task_id = taskId;
    if (taskId) {
      const task = projectTasks.find((t) => t.id === taskId);
      if (task) {
        ms.title = task.name;
        // Auto-populate checks from subtasks
        ms.checks = (task.subtasks || []).map((s) => ({
          text: s.name,
          subtask_id: s.id,
        }));
      }
    }
    savePhases(p);
  };

  // Check actions
  const addCheck = (pi: number, mi: number) => {
    const p = [...phases];
    p[pi].milestones[mi].checks.push({ text: "", subtask_id: null });
    savePhases(p);
  };

  const updateCheck = (pi: number, mi: number, ci: number, text: string) => {
    const p = [...phases];
    p[pi].milestones[mi].checks[ci].text = text;
    savePhases(p);
  };

  const deleteCheck = (pi: number, mi: number, ci: number) => {
    const p = [...phases];
    p[pi].milestones[mi].checks.splice(ci, 1);
    savePhases(p);
  };

  const linkSubtaskToCheck = (pi: number, mi: number, ci: number, subtaskId: string | null) => {
    const p = [...phases];
    if (subtaskId) {
      const task = projectTasks.find((t) => (t.subtasks || []).some((s) => s.id === subtaskId));
      const sub = task?.subtasks?.find((s) => s.id === subtaskId);
      if (sub) {
        p[pi].milestones[mi].checks[ci].text = sub.name;
        p[pi].milestones[mi].checks[ci].subtask_id = subtaskId;
      }
    } else {
      p[pi].milestones[mi].checks[ci].subtask_id = null;
    }
    savePhases(p);
  };

  // Drag milestones
  const handleMsDragStart = (pi: number, mi: number) => setDragMilestone({ pi, mi });
  const handleMsDragOver = (e: React.DragEvent, pi: number, mi: number) => {
    e.preventDefault();
    if (!dragMilestone || (dragMilestone.pi === pi && dragMilestone.mi === mi)) return;
    const p = [...phases];
    const [moved] = p[dragMilestone.pi].milestones.splice(dragMilestone.mi, 1);
    p[pi].milestones.splice(mi, 0, moved);
    setPhases(p);
    setDragMilestone({ pi, mi });
  };
  const handleMsDragEnd = () => {
    setDragMilestone(null);
    savePhases([...phases]);
  };

  // Get subtask progress from project tasks
  const getSubtaskProgress = (subtaskId: string): number | null => {
    for (const t of projectTasks) {
      const sub = (t.subtasks || []).find((s) => s.id === subtaskId);
      if (sub) return sub.progress;
    }
    return null;
  };

  const getTaskProgress = (taskId: string): number | null => {
    const t = projectTasks.find((t) => t.id === taskId);
    return t ? t.progress : null;
  };

  // All subtasks for picker
  const allSubtasks: Array<{ id: string; name: string; taskName: string }> = [];
  for (const t of projectTasks) {
    for (const s of t.subtasks || []) {
      allSubtasks.push({ id: s.id, name: s.name, taskName: t.name });
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-title text-2xl text-bright">Roadmap</h1>
          <p className="text-sm text-txt2 mt-0.5">
            Visual timeline for your project milestones
            {saving && <span className="text-yellow-500 ml-2 animate-pulse">· saving...</span>}
            {!saving && selectedProject && <span className="text-green-acc ml-2">· saved</span>}
          </p>
        </div>
        <select value={selectedProject || ""} onChange={(e) => setSelectedProject(e.target.value || null)}
          className="bg-surface border border-border rounded-lg px-4 py-2 text-sm text-txt min-w-[200px]">
          <option value="">Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      </div>

      {!selectedProject && (
        <div className="text-center py-20 text-txt3">
          <p className="text-4xl mb-3 opacity-30">📋</p>
          <p className="text-lg font-medium text-txt2 mb-1">Select a project</p>
          <p className="text-sm">Choose a project to build its roadmap</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-violet border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {selectedProject && !loading && (
        <div>
          {/* Phases */}
          {phases.map((phase, pi) => (
            <div key={pi} className="mb-8">
              {/* Phase header */}
              <div className="flex items-center gap-3 mb-4 group">
                <input value={phase.name} onChange={(e) => updatePhase(pi, e.target.value)}
                  className="text-[10px] font-bold uppercase tracking-[1.2px] text-txt3 bg-transparent border-b border-transparent focus:border-border2 focus:text-txt2 outline-none flex-1 py-1"
                  spellCheck={false} placeholder="Phase name..." />
                <button onClick={() => deletePhase(pi)}
                  className="text-[10px] px-2 py-1 rounded border border-border text-txt3 opacity-0 group-hover:opacity-100 hover:border-danger hover:text-danger transition-all">
                  delete
                </button>
              </div>

              {/* Road with line */}
              <div className="relative pl-10">
                <div className="absolute left-[17px] top-0 bottom-0 w-[3px] rounded bg-border" />

                {phase.milestones.map((ms, mi) => {
                  const st = ms.status;
                  const sc = STATUS_COLORS[st];
                  const taskProgress = ms.project_task_id ? getTaskProgress(ms.project_task_id) : null;

                  return (
                    <div key={ms.id}
                      draggable
                      onDragStart={() => handleMsDragStart(pi, mi)}
                      onDragOver={(e) => handleMsDragOver(e, pi, mi)}
                      onDragEnd={handleMsDragEnd}
                      className={cn("relative pb-5 last:pb-0", dragMilestone?.pi === pi && dragMilestone?.mi === mi && "opacity-50")}>
                      {/* Dot */}
                      <div onClick={() => cycleStatus(pi, mi)}
                        className={cn("absolute -left-[28px] top-[6px] w-3 h-3 rounded-full border-[2.5px] z-[2] cursor-pointer hover:scale-130 transition-transform", sc.dot)}
                        style={st === "active" ? { boxShadow: "0 0 0 4px rgba(124,111,255,0.12)" } : undefined} />

                      {/* Card */}
                      <div className={cn("bg-surface border rounded-xl p-3 transition-all hover:border-border2 group/card",
                        st === "done" && "border-l-[3px] border-l-green-acc border-border",
                        st === "active" && "border-l-[3px] border-l-violet border-border",
                        st === "future" && "border-border")}>

                        {/* Top row */}
                        <div className="flex items-center gap-2 mb-2">
                          <input value={ms.date_label} onChange={(e) => updateMilestone(pi, mi, "date_label", e.target.value)}
                            className="font-mono text-[11px] text-txt3 bg-transparent border-b border-transparent focus:border-violet outline-none w-24"
                            placeholder="Week 1..." spellCheck={false} />
                          <button onClick={() => cycleStatus(pi, mi)}
                            className={cn("text-[9px] font-bold px-2 py-0.5 rounded cursor-pointer transition-all", sc.bg, sc.text)}>
                            {STATUS_LABELS[st]}
                          </button>
                          {taskProgress !== null && (
                            <span className="text-[10px] font-mono text-txt3 ml-1">{taskProgress}%</span>
                          )}
                          <div className="ml-auto flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                            <button onClick={() => deleteMilestone(pi, mi)}
                              className="w-6 h-6 rounded border border-border text-txt3 text-[11px] flex items-center justify-center hover:border-danger hover:text-danger transition-all">×</button>
                          </div>
                        </div>

                        {/* Title — with task picker */}
                        <div className="flex items-center gap-2 mb-1">
                          <input value={ms.title} onChange={(e) => updateMilestone(pi, mi, "title", e.target.value)}
                            className="flex-1 text-sm font-bold text-bright bg-transparent border-b border-transparent focus:border-violet outline-none"
                            placeholder="Milestone title..." spellCheck={false} />
                          <select value={ms.project_task_id || ""} onChange={(e) => linkTaskToMilestone(pi, mi, e.target.value || null)}
                            className="bg-surface3 border border-border rounded px-1.5 py-0.5 text-[10px] text-txt3 max-w-[120px] opacity-0 group-hover/card:opacity-100 transition-opacity"
                            title="Pull from project task">
                            <option value="">📌 Link task</option>
                            {projectTasks.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </div>

                        {/* Description */}
                        <input value={ms.description} onChange={(e) => updateMilestone(pi, mi, "description", e.target.value)}
                          className="text-xs text-txt3 bg-transparent border-b border-transparent focus:border-border2 outline-none w-full"
                          placeholder="Description..." spellCheck={false} />

                        {/* Checklist */}
                        <div className="mt-2 pt-2 border-t border-border/50">
                          {ms.checks.map((ck, ci) => {
                            const subProgress = ck.subtask_id ? getSubtaskProgress(ck.subtask_id) : null;
                            return (
                              <div key={ci} className="flex items-center gap-2 py-1 group/ck">
                                {subProgress !== null ? (
                                  <span className="text-[10px] font-mono w-8 text-right shrink-0"
                                    style={{ color: subProgress >= 100 ? "#4ade80" : subProgress > 0 ? "#7c6fff" : "#5c5a7a" }}>
                                    {subProgress}%
                                  </span>
                                ) : (
                                  <span className="w-8 shrink-0" />
                                )}
                                <input value={ck.text} onChange={(e) => updateCheck(pi, mi, ci, e.target.value)}
                                  className="flex-1 text-xs text-txt2 bg-transparent border-b border-transparent focus:border-border2 outline-none"
                                  placeholder="Task..." spellCheck={false} />
                                <select value={ck.subtask_id || ""} onChange={(e) => linkSubtaskToCheck(pi, mi, ci, e.target.value || null)}
                                  className="bg-transparent border-none text-[9px] text-txt3 max-w-[100px] opacity-0 group-hover/ck:opacity-100"
                                  title="Link to subtask">
                                  <option value="">↳ link</option>
                                  {allSubtasks.map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </select>
                                <button onClick={() => deleteCheck(pi, mi, ci)}
                                  className="text-[10px] w-4 h-4 flex items-center justify-center text-txt3 hover:text-danger opacity-0 group-hover/ck:opacity-100 transition-opacity">×</button>
                              </div>
                            );
                          })}
                          <button onClick={() => addCheck(pi, mi)}
                            className="text-[11px] text-txt3 hover:text-violet2 font-semibold mt-1 transition-colors">
                            + Add task
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add milestone */}
              <button onClick={() => addMilestone(pi)}
                className="ml-10 mt-3 flex items-center gap-2 px-4 py-2 border border-dashed border-border rounded-lg text-[11px] font-bold text-txt3 hover:border-violet hover:text-violet2 transition-all">
                + Add milestone
              </button>
            </div>
          ))}

          {/* Add phase */}
          <button onClick={addPhase}
            className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-border rounded-lg text-[11px] font-bold text-txt3 hover:border-violet hover:text-violet2 transition-all">
            + Add phase
          </button>
        </div>
      )}
    </div>
  );
}
