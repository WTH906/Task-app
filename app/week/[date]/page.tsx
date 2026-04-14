"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { WeekTask, WeekDay } from "@/lib/types";
import { DAY_COLORS, DAY_NAMES_FULL, cn, addDays, formatDate } from "@/lib/utils";
import { syncTaskCompletion } from "@/lib/sync";
import { reorderRows } from "@/lib/db-helpers";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { fetchWeekTasksForDate, fetchWeekDayMetaSingle, fetchWeekTemplateSingle, fetchProjectsSlim, fetchProjectTasksSlim } from "@/lib/queries";
import { useToast } from "@/components/Toast";

export default function DayDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { userId } = useCurrentUser();
  const { toast } = useToast();
  const dateKey = params.date as string;
  const dateObj = new Date(dateKey + "T00:00:00");
  const dayNum = dateObj.getDay();
  const color = DAY_COLORS[dayNum];

  const [tasks, setTasks] = useState<WeekTask[]>([]);
  const [dayMeta, setDayMeta] = useState<WeekDay | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [newTask, setNewTask] = useState("");
  const [now, setNow] = useState(new Date());
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; title: string; color: string }>>([]);
  const [linkProject, setLinkProject] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<"none" | "main" | "subtask">("none");
  const [linkParentTask, setLinkParentTask] = useState<string | null>(null);
  const [projectTasks, setProjectTasks] = useState<Array<{ id: string; name: string }>>([]);

  const today = formatDate(new Date());
  const isToday = dateKey === today;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();

      const [taskData, meta, projs] = await Promise.all([
        fetchWeekTasksForDate(supabase, userId, dateKey),
        fetchWeekDayMetaSingle(supabase, userId, dateKey),
        fetchProjectsSlim(supabase, userId),
      ]);

      setTasks(taskData);
      setProjects(projs);

      if (meta) {
        setDayMeta(meta);
        setTitle(meta.title);
        setNotes(meta.notes);
      } else {
        const tmplTitle = await fetchWeekTemplateSingle(supabase, userId, dayNum);
        if (tmplTitle) setTitle(tmplTitle);
      }
    } catch (err) {
      console.error("Day load failed:", err);
      toast("Failed to load day", "error");
    }
  }, [dateKey, dayNum, userId, toast]);

  useEffect(() => { document.title = `Comfy Board — ${DAY_NAMES_FULL[dayNum]} ${dateKey}`; }, [dayNum, dateKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isToday) return;
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, [isToday]);

  const saveMeta = async (field: "title" | "notes", value: string) => {
    const supabase = createClient();
    if (dayMeta) {
      await supabase.from("week_days").update({ [field]: value }).eq("id", dayMeta.id);
    } else {
      const { data } = await supabase
        .from("week_days")
        .upsert(
          { user_id: userId, date_key: dateKey, title: field === "title" ? value : title, notes: field === "notes" ? value : notes },
          { onConflict: "user_id,date_key" }
        )
        .select()
        .single();
      if (data) setDayMeta(data);
    }
  };

  const setAsDefault = async () => {
    if (!title.trim()) return;
    const supabase = createClient();
    await supabase.from("week_templates").upsert(
      { user_id: userId, weekday: dayNum, title: title.trim() },
      { onConflict: "user_id,weekday" }
    );
  };

  const toggleDone = async (task: WeekTask) => {
    const supabase = createClient();
    const newDone = !task.done;
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, done: newDone } : t));
    await supabase.from("week_tasks").update({ done: newDone }).eq("id", task.id);
    if (task.project_task_id) {
      const isSubtaskEntry = task.text.includes("↳");
      const newProgress = newDone ? 100 : 0;

      if (isSubtaskEntry) {
        const subName = task.text.split("↳").pop()?.trim() || "";
        const { data: matchedSub } = await supabase
          .from("subtasks").select("id").eq("task_id", task.project_task_id)
          .ilike("name", subName).limit(1).maybeSingle();
        if (matchedSub) {
          await supabase.from("subtasks").update({ progress: newProgress }).eq("id", matchedSub.id);
        }
        const { data: allSubs } = await supabase
          .from("subtasks").select("progress").eq("task_id", task.project_task_id);
        if (allSubs && allSubs.length > 0) {
          const avg = Math.round(allSubs.reduce((s, st) => s + st.progress, 0) / allSubs.length);
          await supabase.from("project_tasks").update({ progress: avg }).eq("id", task.project_task_id);
          await syncTaskCompletion(supabase, userId, task.project_task_id, avg);
        }
      } else {
        const { data: subs } = await supabase.from("subtasks").select("id").eq("task_id", task.project_task_id).limit(1);
        if (!subs || subs.length === 0) {
          await supabase.from("project_tasks").update({ progress: newProgress }).eq("id", task.project_task_id);
        } else {
          await supabase.from("subtasks").update({ progress: newProgress }).eq("task_id", task.project_task_id);
          await supabase.from("project_tasks").update({ progress: newProgress }).eq("id", task.project_task_id);
        }
        await syncTaskCompletion(supabase, userId, task.project_task_id, newProgress);
      }
    }
    // If marking done and this came from a quick task, remove it from quick_tasks
    if (newDone && !task.project_task_id) {
      await supabase.from("quick_tasks").delete()
        .eq("user_id", userId).eq("name", task.text).eq("date_key", task.date_key);
    }
  };

  const addTask = async () => {
    if (!newTask.trim()) return;
    const supabase = createClient();
    const text = newTask.trim();
    const proj = linkProject ? projects.find((p) => p.id === linkProject) : null;
    const taggedText = proj
      ? (linkType === "subtask" ? `[${proj.title}] ↳ ${text}` : `[${proj.title}] ${text}`)
      : text;

    let projectTaskId: string | null = null;

    if (proj && linkType === "main") {
      const { data: pt } = await supabase.from("project_tasks").insert({
        project_id: proj.id, user_id: userId, name: text,
        est_minutes: 0, deadline: dateKey, progress: 0,
        notes: "", elapsed_seconds: 0, sort_order: 999,
      }).select().single();
      if (pt) projectTaskId = pt.id;
    } else if (proj && linkType === "subtask" && linkParentTask) {
      await supabase.from("subtasks").insert({
        task_id: linkParentTask, user_id: userId, name: text,
        est_minutes: 0, deadline: dateKey, progress: 0,
        notes: "", sort_order: 999,
      });
      projectTaskId = linkParentTask;
      // Recalc parent progress to include the new 0% subtask
      const { data: allSubs } = await supabase
        .from("subtasks").select("progress").eq("task_id", linkParentTask);
      if (allSubs && allSubs.length > 0) {
        const avg = Math.round(allSubs.reduce((s: number, st: { progress: number }) => s + st.progress, 0) / allSubs.length);
        await supabase.from("project_tasks").update({ progress: avg }).eq("id", linkParentTask);
      }
    }

    const { data: newWeekTask } = await supabase.from("week_tasks").insert({
      user_id: userId, date_key: dateKey, text: taggedText,
      sort_order: tasks.length,
      project_id: proj?.id || null,
      project_task_id: projectTaskId,
    }).select().single();

    if (newWeekTask) {
      setTasks((prev) => [...prev, newWeekTask as WeekTask]);
    }

    setNewTask("");
    setLinkProject(null);
    setLinkType("none");
    setLinkParentTask(null);
    setProjectTasks([]);
  };

  const loadProjectTasksForLink = async (projectId: string) => {
    const supabase = createClient();
    setProjectTasks(await fetchProjectTasksSlim(supabase, projectId));
  };

  const deleteTask = async (id: string) => {
    const supabase = createClient();
    await supabase.from("week_tasks").delete().eq("id", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const carryOver = async () => {
    const supabase = createClient();
    const yesterday = formatDate(addDays(dateObj, -1));
    const { data: yestTasks } = await supabase
      .from("week_tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("date_key", yesterday)
      .eq("done", false);

    if (!yestTasks?.length) { alert("No unfinished tasks from yesterday"); return; }

    const newTasks: WeekTask[] = [];
    for (const t of yestTasks) {
      const { data: copied } = await supabase.from("week_tasks").insert({
        user_id: userId,
        date_key: dateKey,
        text: t.text,
        project_id: t.project_id,
        project_task_id: t.project_task_id,
        sort_order: tasks.length + newTasks.length,
      }).select().single();
      if (copied) newTasks.push(copied as WeekTask);
    }
    setTasks((prev) => [...prev, ...newTasks]);
  };

  // Drag
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const nt = [...tasks];
    const [moved] = nt.splice(dragIdx, 1);
    nt.splice(idx, 0, moved);
    setTasks(nt);
    setDragIdx(idx);
  };
  const handleDragEnd = async () => {
    setDragIdx(null);
    if (!userId) return;
    const supabase = createClient();
    await reorderRows(supabase, "week_tasks", tasks.map((t) => t.id), userId);
  };

  const prevDay = formatDate(addDays(dateObj, -1));
  const nextDay = formatDate(addDays(dateObj, 1));

  const dateLabel = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      {/* Nav */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push(`/week/${prevDay}`)}
          className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm text-txt2 hover:text-txt"
        >
          ‹ Prev
        </button>
        <button
          onClick={() => router.push("/week")}
          className="text-sm text-txt3 hover:text-violet2"
        >
          Back to Week
        </button>
        <button
          onClick={() => router.push(`/week/${nextDay}`)}
          className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm text-txt2 hover:text-txt"
        >
          Next ›
        </button>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="font-title text-2xl" style={{ color }}>
          {DAY_NAMES_FULL[dayNum]}
        </h1>
        <p className="text-sm text-txt2 mt-0.5">{dateLabel}</p>
        {isToday && (
          <p className="text-sm font-mono text-violet2 mt-1">
            {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        )}
      </div>

      {/* Theme title */}
      <div className="mb-4 flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => saveMeta("title", title)}
          placeholder="Day theme..."
          className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder-txt3"
        />
        <button
          onClick={setAsDefault}
          className="text-xs text-txt3 hover:text-violet2 whitespace-nowrap"
          title="Set as default for this weekday"
        >
          Set default
        </button>
      </div>

      {/* Carry over */}
      <button
        onClick={carryOver}
        className="text-xs text-txt3 hover:text-violet2 mb-4 transition-colors"
      >
        ↩ Carry over unfinished from yesterday
      </button>

      {/* Tasks */}
      <div className="space-y-1.5 mb-4">
        {tasks.map((task, idx) => (
          <div
            key={task.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            className={cn(
              "flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2.5 group",
              dragIdx === idx && "opacity-50"
            )}
          >
            <span className="cursor-grab text-txt3 opacity-0 group-hover:opacity-100 select-none text-xs">
              ⠿
            </span>
            <input
              type="checkbox"
              checked={task.done}
              onChange={() => toggleDone(task)}
              style={{ accentColor: color }}
            />
            <span className={cn("flex-1 text-sm", task.done && "line-through text-txt3 opacity-60")}>
              {task.project_id && (
                <span className="text-violet2 font-medium text-xs">
                  {task.text.match(/^\[.*?\]/)?.[0]}{" "}
                </span>
              )}
              {task.text.replace(/^\[.*?\]\s*/, "")}
            </span>
            <button
              onClick={() => deleteTask(task.id)}
              className="text-txt3 hover:text-danger opacity-0 group-hover:opacity-100 transition-all text-sm"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Add task */}
      <div className="space-y-3 mb-6">
        <p className="text-[10px] text-txt3 uppercase tracking-wider">Add new task</p>
        <div className="flex flex-wrap gap-2">
          <select value={linkProject || ""} onChange={(e) => {
            const val = e.target.value || null;
            setLinkProject(val);
            setLinkType(val ? "none" : "none");
            setLinkParentTask(null);
            setProjectTasks([]);
            if (val) loadProjectTasksForLink(val);
          }}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-xs text-txt min-w-[140px]">
            <option value="">— No project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>● {p.title}</option>
            ))}
          </select>

          {linkProject && (
            <select value={linkType} onChange={(e) => {
              setLinkType(e.target.value as "none" | "main" | "subtask");
              setLinkParentTask(null);
            }}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-xs text-txt">
              <option value="none">Just tag it</option>
              <option value="main">→ Create as main task</option>
              {projectTasks.length > 0 && <option value="subtask">↳ Create as subtask of...</option>}
            </select>
          )}

          {linkProject && linkType === "subtask" && projectTasks.length > 0 && (
            <select value={linkParentTask || ""} onChange={(e) => setLinkParentTask(e.target.value || null)}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-xs text-txt flex-1 min-w-[140px]">
              <option value="">— Pick parent task —</option>
              {projectTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>

        {linkProject && (
          <p className="text-[10px] px-1" style={{ color: projects.find(p => p.id === linkProject)?.color || "#7c6fff" }}>
            {linkType === "none" && "→ Will add a tagged task to this day only"}
            {linkType === "main" && "→ Will create a new main task in the project + add to this day"}
            {linkType === "subtask" && !linkParentTask && "→ Select which main task to add the subtask under"}
            {linkType === "subtask" && linkParentTask && `→ Will create a subtask under "${projectTasks.find(t => t.id === linkParentTask)?.name}" + add to this day`}
          </p>
        )}

        <div className="flex gap-2">
          <input value={newTask} onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder={linkProject ? "Task name..." : "Add a task..."}
            className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder-txt3" />
          <button onClick={addTask}
            disabled={!newTask.trim() || (linkType === "subtask" && !linkParentTask)}
            className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white disabled:opacity-50 transition-colors">
            Add
          </button>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm text-txt2 mb-1.5">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => saveMeta("notes", notes)}
          placeholder="Day notes..."
          className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder-txt3 h-28 resize-none"
        />
      </div>
    </div>
  );
}
