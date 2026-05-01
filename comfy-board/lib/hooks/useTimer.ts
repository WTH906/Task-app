"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { ProjectTask, Subtask } from "@/lib/types";
import { playAlarm, formatSeconds } from "@/lib/utils";
import { logActivity } from "@/lib/activity";

interface UseTimerOptions {
  userId: string;
  projectId: string;
  tasks: ProjectTask[];
  onElapsedChange: (timerId: string, elapsed: number) => void;
  onTaskUpdate: (taskId: string, updates: Partial<ProjectTask>) => void;
}

/**
 * Timer hook with DB-backed started_at for drift-proof tracking.
 *
 * Truth lives in the DB:
 * - `timer_started_at` — set when timer starts, cleared on stop
 * - `elapsed_seconds` — accumulated time from previous sessions
 *
 * Live elapsed = (now - started_at)/1000 + elapsed_seconds
 * The interval only triggers UI re-renders — it doesn't accumulate time.
 */
export function useTimer({ userId, projectId, tasks, onElapsedChange, onTaskUpdate }: UseTimerOptions) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startedAtRef = useRef<number>(0); // epoch ms when timer started
  const baseElapsedRef = useRef<number>(0); // elapsed_seconds at start

  // Resolve task/subtask from a timerId ("taskId" or "sub:subtaskId")
  const resolveTimer = useCallback((timerId: string) => {
    const isSub = timerId.startsWith("sub:");
    const id = isSub ? timerId.replace("sub:", "") : timerId;
    let task: ProjectTask | undefined;
    let sub: Subtask | undefined;
    if (isSub) {
      for (const t of tasks) {
        sub = t.subtasks?.find((s) => s.id === id);
        if (sub) { task = t; break; }
      }
    } else {
      task = tasks.find((t) => t.id === id);
    }
    return { isSub, id, task, sub };
  }, [tasks]);

  // Compute live elapsed for the active timer
  const tick = useCallback(() => {
    if (!activeTaskId) return;
    const now = Date.now();
    const live = baseElapsedRef.current + (now - startedAtRef.current) / 1000;
    onElapsedChange(activeTaskId, live);

    // 80% alarm check (main tasks only)
    if (!activeTaskId.startsWith("sub:")) {
      const task = tasks.find((t) => t.id === activeTaskId);
      if (task && task.est_minutes > 0 && !task.alarm_fired_at) {
        const threshold = task.est_minutes * 60 * 0.8;
        if (live >= threshold) {
          playAlarm();
          const supabase = createClient();
          supabase.from("project_tasks").update({ alarm_fired_at: new Date().toISOString() }).eq("id", activeTaskId);
          onTaskUpdate(activeTaskId, { alarm_fired_at: new Date().toISOString() });
        }
      }
    }
  }, [activeTaskId, tasks, onElapsedChange, onTaskUpdate]);

  // Save current elapsed to DB
  const saveToDB = useCallback(async () => {
    if (!activeTaskId) return;
    const supabase = createClient();
    const live = baseElapsedRef.current + (Date.now() - startedAtRef.current) / 1000;
    const rounded = Math.round(live);
    const { isSub, id } = resolveTimer(activeTaskId);
    if (isSub) {
      await supabase.from("subtasks").update({ elapsed_seconds: rounded }).eq("id", id);
    } else {
      await supabase.from("project_tasks").update({ elapsed_seconds: rounded }).eq("id", id);
    }
  }, [activeTaskId, resolveTimer]);

  // Start timer
  const startTimer = useCallback(async (timerId: string) => {
    // Stop any existing timer first
    if (activeTaskId) {
      await stopTimer();
    }

    const { isSub, id } = resolveTimer(timerId);
    const supabase = createClient();
    const now = new Date();

    // Read current elapsed_seconds from local state
    let baseElapsed = 0;
    if (isSub) {
      for (const t of tasks) {
        const s = t.subtasks?.find((sub) => sub.id === id);
        if (s) { baseElapsed = s.elapsed_seconds; break; }
      }
    } else {
      const t = tasks.find((task) => task.id === id);
      if (t) baseElapsed = t.elapsed_seconds;
    }

    // Save started_at to DB
    if (isSub) {
      await supabase.from("subtasks").update({ timer_started_at: now.toISOString() }).eq("id", id);
    } else {
      await supabase.from("project_tasks").update({ timer_started_at: now.toISOString() }).eq("id", id);
    }

    startedAtRef.current = now.getTime();
    baseElapsedRef.current = baseElapsed;
    setActiveTaskId(timerId);
  }, [activeTaskId, tasks, resolveTimer]);

  // Stop timer
  const stopTimer = useCallback(async () => {
    if (!activeTaskId) return;
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

    const supabase = createClient();
    const finalElapsed = Math.round(baseElapsedRef.current + (Date.now() - startedAtRef.current) / 1000);
    const sessionTime = finalElapsed - Math.round(baseElapsedRef.current);
    const { isSub, id, task, sub } = resolveTimer(activeTaskId);

    // Save elapsed + clear started_at
    if (isSub) {
      await supabase.from("subtasks").update({ elapsed_seconds: finalElapsed, timer_started_at: null }).eq("id", id);
      if (sessionTime > 5 && sub) {
        await logActivity(supabase, userId, projectId, "Timer stopped", `↳ ${sub.name} — ${formatSeconds(sessionTime)} tracked`);
      }
    } else {
      await supabase.from("project_tasks").update({ elapsed_seconds: finalElapsed, timer_started_at: null }).eq("id", id);
      if (sessionTime > 5 && task) {
        await logActivity(supabase, userId, projectId, "Timer stopped", `${task.name} — ${formatSeconds(sessionTime)} tracked`);
      }
    }

    onElapsedChange(activeTaskId, finalElapsed);
    setActiveTaskId(null);
  }, [activeTaskId, resolveTimer, userId, projectId, onElapsedChange]);

  const toggleTimer = useCallback((timerId: string) => {
    if (activeTaskId === timerId) stopTimer();
    else startTimer(timerId);
  }, [activeTaskId, startTimer, stopTimer]);

  // Interval for UI ticks (1s)
  useEffect(() => {
    if (!activeTaskId) return;
    intervalRef.current = setInterval(tick, 1000);
    // Also tick immediately
    tick();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [activeTaskId, tick]);

  // Auto-save every 5s + save on visibility hidden
  useEffect(() => {
    if (!activeTaskId) return;
    const autoSave = setInterval(saveToDB, 5000);
    const handleVisibility = () => { if (document.visibilityState === "hidden") saveToDB(); };
    document.addEventListener("visibilitychange", handleVisibility);
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Timer is running — are you sure you want to leave?";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      clearInterval(autoSave);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [activeTaskId, saveToDB]);

  // On mount: check if any task has timer_started_at (resume after page reload)
  useEffect(() => {
    for (const t of tasks) {
      if (t.timer_started_at) {
        startedAtRef.current = new Date(t.timer_started_at).getTime();
        baseElapsedRef.current = t.elapsed_seconds;
        setActiveTaskId(t.id);
        return;
      }
      for (const s of t.subtasks || []) {
        if (s.timer_started_at) {
          startedAtRef.current = new Date(s.timer_started_at).getTime();
          baseElapsedRef.current = s.elapsed_seconds;
          setActiveTaskId(`sub:${s.id}`);
          return;
        }
      }
    }
  // Only run on initial load, not on every tasks change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { activeTaskId, startTimer, stopTimer, toggleTimer };
}
