"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { formatSeconds } from "@/lib/utils";
import { Play, Square } from "lucide-react";

interface WorkClockProps {
  userId: string;
}

export function WorkClock({ userId }: WorkClockProps) {
  const [startedAt, setStartedAt] = useState<number | null>(null); // epoch ms
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [loading, setLoading] = useState(true);

  // Load persisted clock state
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("user_settings")
      .select("work_clock_started_at")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.work_clock_started_at) {
          const ts = new Date(data.work_clock_started_at).getTime();
          setStartedAt(ts);
          setElapsed(Math.round((Date.now() - ts) / 1000));
        }
        setLoading(false);
      });
  }, [userId]);

  // Tick every second
  useEffect(() => {
    if (startedAt === null) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [startedAt]);

  const clockIn = useCallback(async () => {
    const now = new Date();
    const supabase = createClient();
    setStartedAt(now.getTime());
    setElapsed(0);

    await supabase.from("user_settings").upsert({
      user_id: userId,
      work_clock_started_at: now.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: "user_id" });
  }, [userId]);

  const clockOut = useCallback(async () => {
    if (!startedAt) return;
    const duration = Math.round((Date.now() - startedAt) / 1000);
    const today = new Date().toISOString().slice(0, 10);
    const supabase = createClient();

    setStartedAt(null);
    setElapsed(0);

    // Log the session (project_id null = general/unassigned)
    if (duration > 5) {
      supabase.from("time_logs").insert({
        user_id: userId,
        project_id: null,
        task_id: null,
        subtask_id: null,
        duration_seconds: duration,
        date_key: today,
      });
    }

    // Clear the clock
    await supabase.from("user_settings").update({
      work_clock_started_at: null,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }, [userId, startedAt]);

  const isRunning = startedAt !== null;

  if (loading) return null;

  return (
    <button
      onClick={isRunning ? clockOut : clockIn}
      className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs transition-colors group"
      style={{
        background: isRunning ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
        color: isRunning ? "var(--accent2)" : "var(--txt3)",
      }}
      title={isRunning ? "Clock out" : "Clock in"}
    >
      {isRunning ? (
        <Square size={13} className="text-red-acc" fill="currentColor" />
      ) : (
        <Play size={13} fill="currentColor" />
      )}
      <span className={isRunning ? "font-mono font-medium tabular-nums" : ""}>
        {isRunning ? formatSeconds(elapsed) : "Work Clock"}
      </span>
      {isRunning && (
        <span className="ml-auto w-2 h-2 rounded-full bg-green-acc animate-pulse" />
      )}
    </button>
  );
}
