"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { formatSeconds } from "@/lib/utils";
import Link from "next/link";
import { Timer } from "lucide-react";

interface RunningTimer {
  projectId: string;
  projectTitle: string;
  projectColor: string;
  taskName: string;
  startedAt: number; // epoch ms
  baseElapsed: number;
}

export function ActiveTimerBadge({ userId }: { userId: string }) {
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const check = useCallback(async () => {
    const supabase = createClient();

    // Check project_tasks
    const { data: runningTask } = await supabase
      .from("project_tasks")
      .select("id, name, elapsed_seconds, timer_started_at, project_id")
      .eq("user_id", userId)
      .not("timer_started_at", "is", null)
      .limit(1)
      .maybeSingle();

    if (runningTask?.timer_started_at) {
      const { data: proj } = await supabase
        .from("projects").select("title, color").eq("id", runningTask.project_id).single();
      setTimer({
        projectId: runningTask.project_id,
        projectTitle: proj?.title || "Project",
        projectColor: proj?.color || "var(--accent)",
        taskName: runningTask.name,
        startedAt: new Date(runningTask.timer_started_at).getTime(),
        baseElapsed: runningTask.elapsed_seconds || 0,
      });
      return;
    }

    // Check subtasks
    const { data: runningSub } = await supabase
      .from("subtasks")
      .select("id, name, elapsed_seconds, timer_started_at, task_id")
      .eq("user_id", userId)
      .not("timer_started_at", "is", null)
      .limit(1)
      .maybeSingle();

    if (runningSub?.timer_started_at) {
      const { data: parent } = await supabase
        .from("project_tasks").select("project_id").eq("id", runningSub.task_id).single();
      const pid = parent?.project_id;
      const { data: proj } = pid
        ? await supabase.from("projects").select("title, color").eq("id", pid).single()
        : { data: null };
      setTimer({
        projectId: pid || "",
        projectTitle: proj?.title || "Project",
        projectColor: proj?.color || "var(--accent)",
        taskName: `↳ ${runningSub.name}`,
        startedAt: new Date(runningSub.timer_started_at).getTime(),
        baseElapsed: runningSub.elapsed_seconds || 0,
      });
      return;
    }

    setTimer(null);
  }, [userId]);

  // Check on mount and when navigating (pathname changes trigger re-render of parent)
  useEffect(() => { check(); }, [check]);

  // Also re-check periodically in case timer was started/stopped elsewhere
  useEffect(() => {
    const i = setInterval(check, 10000);
    return () => clearInterval(i);
  }, [check]);

  // Tick
  useEffect(() => {
    if (!timer) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setElapsed(0);
      return;
    }
    setElapsed(timer.baseElapsed + Math.round((Date.now() - timer.startedAt) / 1000));
    intervalRef.current = setInterval(() => {
      setElapsed(timer.baseElapsed + Math.round((Date.now() - timer.startedAt) / 1000));
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timer]);

  if (!timer) return null;

  return (
    <Link
      href={`/projects/${timer.projectId}`}
      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-surface2"
      style={{ color: timer.projectColor }}
    >
      <Timer size={13} className="animate-pulse shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-mono font-medium tabular-nums">{formatSeconds(elapsed)}</span>
        <span className="text-[10px] text-txt3 block truncate">{timer.taskName}</span>
      </div>
      <span className="w-2 h-2 rounded-full bg-green-acc animate-pulse shrink-0" />
    </Link>
  );
}
