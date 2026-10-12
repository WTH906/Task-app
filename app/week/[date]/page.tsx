"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { WeekTask, WeekDay } from "@/lib/types";
import { DAY_COLORS, DAY_NAMES_FULL, cn, addDays, formatDate, LEGACY_TAG_RE } from "@/lib/utils";
import { rescheduleWeekTask } from "@/lib/sync";
import { announceTaskChanged } from "@/lib/task-events";
import {
  fetchDayEstimates, estimateForTask, writeBlock, clearBlockOn,
  createPlannerTaskInSlot, toggleWeekTaskDone,
} from "@/lib/day-blocks";
import { useSettings } from "@/lib/hooks/useSettings";
import { DayGrid } from "@/components/DayGrid";
import { ScheduleModal, type ScheduleTarget } from "@/components/ScheduleModal";
import { type Block, hasBlock } from "@/lib/schedule";
import { reorderRows } from "@/lib/db-helpers";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { fetchWeekTasksForDate, fetchWeekDayMetaSingle, fetchWeekTemplateSingle, fetchProjectsSlim, fetchProjectTasksSlim } from "@/lib/queries";
import { injectRoutineTasksForDay } from "@/lib/routine-scheduler";
import { useToast } from "@/components/Toast";
import { useLocale, dateLocale } from "@/lib/i18n/useLocale";
import { CalendarDays } from "lucide-react";

export default function DayDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { userId } = useCurrentUser();
  const { toast } = useToast();
  const { t, locale } = useLocale();
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

  // Scheduler (migration v24). Off by default — most tasks only ever need a
  // day. When it's off the page keeps its plain list and any times already
  // set stay in the database untouched.
  const { has } = useSettings();
  const showGrid = has("scheduler");
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);
  /** est_minutes for the project tasks/subtasks these rows mirror. */
  const [estimates, setEstimates] = useState<Record<string, number>>({});

  const today = formatDate(new Date());
  const isToday = dateKey === today;

  // A row's project comes from project_id, not from a "[Project]" prefix in
  // its text (removed in migration v21).
  const projectColorById: Record<string, string> = {};
  const projectTitleById: Record<string, string> = {};
  for (const p of projects) {
    projectColorById[p.id] = p.color || "#e05555";
    projectTitleById[p.id] = p.title;
  }

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();

      if (has("routineInScheduler")) {
        await injectRoutineTasksForDay(supabase, userId, dateKey);
      }

      const [taskData, meta, projs] = await Promise.all([
        fetchWeekTasksForDate(supabase, userId, dateKey),
        fetchWeekDayMetaSingle(supabase, userId, dateKey),
        fetchProjectsSlim(supabase, userId),
      ]);

      setTasks(taskData);
      setProjects(projs);

      // Estimates for the rows that mirror a project task or subtask. Used
      // ONLY to pre-fill a block's length when you first schedule something
      // — never written back, because est_minutes is a record of how long the
      // work takes and dragging a block around your day must not rewrite it.
      setEstimates(await fetchDayEstimates(supabase, taskData));

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

  /**
   * The whole tick cascade lives in lib/day-blocks.ts, because the same grid
   * is now shown here and in the week view's popup. Hand-writing it per
   * screen is how this app ended up with three copies of the calendar sync,
   * two of which were wrong.
   */
  const toggleDone = async (task: WeekTask) => {
    const newDone = !task.done;
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, done: newDone } : t));

    const { error } = await toggleWeekTaskDone(createClient(), userId, task, newDone, "day");
    if (error) {
      toast("Couldn't save: " + error, "error");
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, done: !newDone } : t));
    }
  };

  const addTask = async () => {
    if (!newTask.trim()) return;
    const supabase = createClient();
    const text = newTask.trim();
    const proj = linkProject ? projects.find((p) => p.id === linkProject) : null;
    // project_id carries the project; no prefix baked into the text.
    const taggedText = text;

    let projectTaskId: string | null = null;
    let subtaskId: string | null = null;

    if (proj && linkType === "main") {
      // The picked day is when to WORK on it (date_key), not when it's DUE.
      // Writing it to `deadline` left the task unscheduled in the project and
      // flagged it overdue the following morning.
      const { data: pt } = await supabase.from("project_tasks").insert({
        project_id: proj.id, user_id: userId, name: text,
        est_minutes: 0, date_key: dateKey, deadline: null, progress: 0,
        notes: "", elapsed_seconds: 0, sort_order: 999,
      }).select().single();
      if (pt) projectTaskId = pt.id;
    } else if (proj && linkType === "subtask" && linkParentTask) {
      const { data: sub } = await supabase.from("subtasks").insert({
        task_id: linkParentTask, user_id: userId, name: text,
        est_minutes: 0, date_key: dateKey, deadline: null, progress: 0,
        notes: "", sort_order: 999,
      }).select().single();
      if (sub) {
        projectTaskId = linkParentTask;
        subtaskId = (sub as { id: string }).id;
      }
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
      subtask_id: subtaskId,
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

  // ── Time blocks (migration v24) ──────────────────────────────────────
  //
  // Only `week_tasks` is ever touched here. A block is when you set time
  // aside; `est_minutes` on the project task is how long the work takes.
  // They are different facts and are allowed to disagree, so nothing in this
  // section writes to a project task or subtask.

  const stripTag = (t: WeekTask) => (t.project_id ? t.text.replace(LEGACY_TAG_RE, "") : t.text);

  const estimateFor = (t: WeekTask): number | null => estimateForTask(t, estimates);

  const setBlock = async (taskId: string, block: Block) => {
    const before = tasks.find((t) => t.id === taskId);
    setTasks((prev) => prev.map((t) => t.id === taskId
      ? { ...t, start_minute: block.start, end_minute: block.end } : t));

    const { error } = await writeBlock(createClient(), taskId, block);

    if (error) {
      toast("Couldn't save the time: " + error, "error");
      if (before) {
        setTasks((prev) => prev.map((t) => t.id === taskId
          ? { ...t, start_minute: before.start_minute, end_minute: before.end_minute } : t));
      }
    }
  };

  /**
   * What the picker's Save does. Two things can have changed: the day and the
   * hours.
   *
   * Changing the day is a RESCHEDULE, not an edit — the entry stays on its
   * original day marked as moved, so the stats still show it slipped. That
   * behaviour used to live only in a modal on the week page; it lives in
   * lib/sync.ts now so deleting that modal couldn't delete the feature.
   */
  const savePicker = async (taskId: string, block: Block | null, newDate?: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const supabase = createClient();

    if (newDate) {
      const res = await rescheduleWeekTask(
        supabase, userId,
        { ...task, start_minute: block?.start ?? null, end_minute: block?.end ?? null },
        newDate
      );
      if (res.error) { toast("Couldn't move it: " + res.error, "error"); return; }

      // The old row stays, marked — DayGrid filters those out, and the list
      // renders them greyed.
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, rescheduled_to: newDate } : t));
      announceTaskChanged({ taskId: task.project_task_id, source: "day" });
      toast(`Moved to ${newDate}`, "success");
      return;
    }

    if (block) await setBlock(taskId, block);
  };

  const clearBlock = async (taskId: string) => {
    const before = tasks.find((t) => t.id === taskId);
    setTasks((prev) => prev.map((t) => t.id === taskId
      ? { ...t, start_minute: null, end_minute: null } : t));

    const { error } = await clearBlockOn(createClient(), taskId);

    if (error) {
      toast("Couldn't clear the time: " + error, "error");
      if (before) {
        setTasks((prev) => prev.map((t) => t.id === taskId
          ? { ...t, start_minute: before.start_minute, end_minute: before.end_minute } : t));
      }
    }
  };

  /** A task sketched directly onto the grid. Planner-only, like quick capture. */
  const createInSlot = async (text: string, block: Block) => {
    const { row, error } = await createPlannerTaskInSlot(
      createClient(), userId, dateKey, text, block, tasks.length
    );
    if (error) { toast("Couldn't add that: " + error, "error"); return; }
    if (row) setTasks((prev) => [...prev, row]);
  };

  const openPicker = (t: WeekTask) => {
    setScheduleTarget({
      id: t.id,
      label: stripTag(t),
      dateKey,
      estMinutes: estimateFor(t),
      current: hasBlock(t)
        ? { start: t.start_minute as number, end: t.end_minute as number }
        : null,
      existing: tasks
        .filter((x) => x.id !== t.id && hasBlock(x))
        .map((x) => ({ start: x.start_minute as number, end: x.end_minute as number })),
    });
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

    if (!yestTasks?.length) { alert(t("day.noUnfinished")); return; }

    const newTasks: WeekTask[] = [];
    for (const t of yestTasks) {
      const { data: copied } = await supabase.from("week_tasks").insert({
        user_id: userId,
        date_key: dateKey,
        text: t.text,
        project_id: t.project_id,
        project_task_id: t.project_task_id,
        subtask_id: t.subtask_id,
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

  const moveItem = async (idx: number, direction: number) => {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= tasks.length || !userId) return;
    const newTasks = [...tasks];
    [newTasks[idx], newTasks[newIdx]] = [newTasks[newIdx], newTasks[idx]];
    setTasks(newTasks);
    const supabase = createClient();
    await reorderRows(supabase, "week_tasks", newTasks.map((t) => t.id), userId);
  };

  const prevDay = formatDate(addDays(dateObj, -1));
  const nextDay = formatDate(addDays(dateObj, 1));

  const dtLocale = dateLocale(locale);
  const dateLabel = dateObj.toLocaleDateString(dtLocale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="page-shell page-shell--list">
      {/* Nav */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push(`/week/${prevDay}`)}
          className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm text-txt2 hover:text-txt"
        >
          ‹ {t("common.prev")}
        </button>
        <button
          onClick={() => router.push("/week")}
          className="text-sm text-txt3 hover:text-violet2"
        >
          {t("day.backToWeek")}
        </button>
        <button
          onClick={() => router.push(`/week/${nextDay}`)}
          className="px-3 py-1.5 rounded-lg bg-surface border border-border text-sm text-txt2 hover:text-txt"
        >
          {t("common.next")} ›
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
            {now.toLocaleTimeString(dtLocale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        )}
      </div>

      {/* Theme title */}
      <div className="mb-4 flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => saveMeta("title", title)}
          placeholder={t("day.dayTheme")}
          className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder-txt3"
        />
        <button
          onClick={setAsDefault}
          className="text-xs text-txt3 hover:text-violet2 whitespace-nowrap"
          title="Set as default for this weekday"
        >
          {t("day.setDefault")}
        </button>
      </div>

      {/* Carry over */}
      <button
        onClick={carryOver}
        className="text-xs text-txt3 hover:text-violet2 mb-4 transition-colors"
      >
        ↩ {t("day.carryOver")}
      </button>

      {/*
        Tasks. With the scheduler on, the day becomes an hour grid with an
        unscheduled column beside it; with it off, the plain list this page
        has always been. Both read and write exactly the same rows — the
        toggle changes the surface, never the data.
      */}
      {showGrid ? (
        <div className="mb-4">
          <DayGrid
            tasks={tasks}
            isToday={isToday}
            color={color}
            projectColorById={projectColorById}
            projectTitleById={projectTitleById}
            estimateFor={estimateFor}
            onToggleDone={toggleDone}
            onSetBlock={setBlock}
            onClearBlock={clearBlock}
            onOpenPicker={openPicker}
            onCreateInSlot={createInSlot}
            onDelete={deleteTask}
            stripTag={stripTag}
          />
        </div>
      ) : (
        <div className="space-y-1.5 mb-4">
          {tasks.map((task, idx) => (
            <div
              key={task.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={cn(
                "flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2.5 group card-float",
                dragIdx === idx && "opacity-50"
              )}
              style={task.project_id && projectColorById[task.project_id]
                ? { borderLeftWidth: 3, borderLeftColor: projectColorById[task.project_id] }
                : undefined}
              title={task.project_id ? projectTitleById[task.project_id] : undefined}
            >
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <span className="cursor-grab text-txt3 select-none text-xs">⠿</span>
                <div className="flex flex-col">
                  <button type="button" aria-label="Move up" disabled={idx === 0}
                    onClick={() => { moveItem(idx, -1).catch(() => {}); }}
                    className="p-0.5 min-w-[24px] min-h-[20px] flex items-center justify-center text-txt3 hover:text-violet2 disabled:opacity-30 transition-colors rounded">
                    <span aria-hidden="true" className="text-[10px]">▲</span>
                  </button>
                  <button type="button" aria-label="Move down" disabled={idx === tasks.length - 1}
                    onClick={() => { moveItem(idx, 1).catch(() => {}); }}
                    className="p-0.5 min-w-[24px] min-h-[20px] flex items-center justify-center text-txt3 hover:text-violet2 disabled:opacity-30 transition-colors rounded">
                    <span aria-hidden="true" className="text-[10px]">▼</span>
                  </button>
                </div>
              </div>
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => toggleDone(task)}
                style={{ accentColor: color }}
              />
              <span className={cn("flex-1 text-sm", task.done && "line-through text-txt3 opacity-60")}>
                {task.subtask_id && <span className="text-txt3 mr-1" aria-hidden>↳</span>}
                {stripTag(task)}
                {task.rescheduled_to && (
                  <span className="block text-[10px] text-amber mt-0.5">
                    → {t("week.rescheduled")} {task.rescheduled_to}
                  </span>
                )}
              </span>
              {/*
                Moving a task to another day. This used to live only inside the
                week page's day modal — when that modal went, this is where the
                feature landed, so it stays reachable with the hour scheduler
                switched off.
              */}
              {!task.rescheduled_to && (
                <button
                  type="button"
                  onClick={() => openPicker(task)}
                  title="Move to another day"
                  aria-label={`Move ${stripTag(task)} to another day`}
                  className="text-txt3 hover:text-amber opacity-0 group-hover:opacity-100 focus-within:opacity-100 focus:opacity-100 transition-all text-sm"
                >
                  <CalendarDays size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => deleteTask(task.id)}
                aria-label="Delete"
                className="text-txt3 hover:text-danger opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all text-sm"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add task */}
      <div className="space-y-3 mb-6">
        <p className="text-[10px] text-txt3 uppercase tracking-wider">{t("day.addNewTask")}</p>
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
            <option value="">— {t("day.noProject")} —</option>
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
              <option value="none">{t("day.justTagIt")}</option>
              <option value="main">→ {t("day.createMainTask")}</option>
              {projectTasks.length > 0 && <option value="subtask">↳ {t("day.createSubtask")}</option>}
            </select>
          )}

          {linkProject && linkType === "subtask" && projectTasks.length > 0 && (
            <select value={linkParentTask || ""} onChange={(e) => setLinkParentTask(e.target.value || null)}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-xs text-txt flex-1 min-w-[140px]">
              <option value="">— {t("day.pickParentTask")} —</option>
              {projectTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>

        {linkProject && (
          <p className="text-[10px] px-1" style={{ color: projects.find(p => p.id === linkProject)?.color || "#7c6fff" }}>
            {linkType === "none" && `→ ${t("day.tagHint")}`}
            {linkType === "main" && `→ ${t("day.mainTaskHint")}`}
            {linkType === "subtask" && !linkParentTask && `→ ${t("day.pickParentTask")}`}
            {linkType === "subtask" && linkParentTask && `→ ${t("day.createSubtask")} "${projectTasks.find(tsk => tsk.id === linkParentTask)?.name}"`}
          </p>
        )}

        <div className="flex gap-2">
          <input value={newTask} onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder={linkProject ? t("day.taskName") : t("day.addATask")}
            className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder-txt3" />
          <button onClick={addTask}
            disabled={!newTask.trim() || (linkType === "subtask" && !linkParentTask)}
            className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-on-accent disabled:opacity-50 transition-colors">
            {t("common.add")}
          </button>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm text-txt2 mb-1.5">{t("common.notes")}</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => saveMeta("notes", notes)}
          placeholder={t("day.dayNotes")}
          className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-txt placeholder-txt3 h-28 resize-none"
        />
      </div>

      <ScheduleModal
        target={scheduleTarget}
        isToday={isToday}
        allowTimes={showGrid}
        onClose={() => setScheduleTarget(null)}
        onSave={savePicker}
        onClear={clearBlock}
      />
    </div>
  );
}
