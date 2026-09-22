"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import {
  type Block, DAY_MINUTES, MIN_BLOCK_MINUTES,
  minutesToLabel, labelToMinutes, formatDuration, clampBlock, suggestBlock,
  nowMinute,
} from "@/lib/schedule";
import { run } from "@/lib/db-helpers";
import { Clock } from "lucide-react";

export interface ScheduleTarget {
  /** week_tasks row id. */
  id: string;
  /** Shown in the modal header so you know what you're placing. */
  label: string;
  dateKey: string;
  /** Only used to pre-fill the duration. Never written back. */
  estMinutes?: number | null;
  /** Existing block, when re-scheduling something already placed. */
  current?: Block | null;
  /** Everything else already on that day, so the suggestion doesn't collide. */
  existing?: Block[];
}

interface Props {
  target: ScheduleTarget | null;
  onClose: () => void;
  /**
   * `newDate` is set only when the day was changed. Moving a task to another
   * day is a reschedule, not an edit: the caller keeps the old entry as a
   * record (see rescheduleWeekTask in lib/sync.ts).
   */
  onSave: (id: string, block: Block | null, newDate?: string) => void | Promise<void>;
  onClear: (id: string) => void | Promise<void>;
  /** True when `target.dateKey` is today — shifts the default start to now. */
  isToday?: boolean;
  /**
   * Whether the hour fields are shown. False when the `scheduler` feature is
   * off, which turns this into a plain "move to another day" dialog — the
   * only way to reach rescheduling in that mode.
   */
  allowTimes?: boolean;
}

/**
 * Pick the two times a task sits between.
 *
 * The duration is pre-filled from the task's estimate when it has one, but
 * that is a starting guess and nothing more: the estimate records how long
 * the work takes so you can look it up when planning something similar, and
 * moving a block around your afternoon must not rewrite it. Nothing in here
 * writes to `est_minutes`.
 */
export function ScheduleModal({
  target, onClose, onSave, onClear, isToday = false, allowTimes = true,
}: Props) {
  const [dayLabel, setDayLabel] = useState("");
  const [startLabel, setStartLabel] = useState("09:00");
  const [endLabel, setEndLabel] = useState("10:00");
  const [saving, setSaving] = useState(false);

  // Re-seed whenever a different task is opened. Keyed on the id rather than
  // the object so re-renders of the same target don't stamp on typing.
  useEffect(() => {
    if (!target) return;
    const seed: Block = target.current
      ?? suggestBlock(target.estMinutes, target.existing ?? [], { isToday, minute: nowMinute() });
    setDayLabel(target.dateKey);
    setStartLabel(minutesToLabel(seed.start));
    setEndLabel(minutesToLabel(seed.end));
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  const dayChanged = !!target && !!dayLabel && dayLabel !== target.dateKey;

  const start = labelToMinutes(startLabel);
  const end = labelToMinutes(endLabel);

  // Why this can't be saved, in the words you'd use out loud. `null` = fine.
  const problem: string | null =
    !dayLabel || !/^\d{4}-\d{2}-\d{2}$/.test(dayLabel) ? "Pick a day."
    : !allowTimes ? null
    : start === null || end === null ? "Enter both times."
    : end <= start ? "The end time has to be after the start."
    : end - start < MIN_BLOCK_MINUTES ? `Blocks are at least ${MIN_BLOCK_MINUTES} minutes.`
    : end > DAY_MINUTES ? "A block has to finish before midnight."
    : null;

  const duration = start !== null && end !== null && end > start ? end - start : null;

  const commit = async () => {
    if (!target || problem || saving) return;
    setSaving(true);
    try {
      // clampBlock is belt-and-braces: the same rule is a CHECK constraint in
      // migration v24, and a rejected write here would be a confusing failure
      // rather than a helpful one.
      const block = allowTimes && start !== null && end !== null
        ? clampBlock(start, end)
        : null;
      await onSave(target.id, block, dayChanged ? dayLabel : undefined);
      onClose();
    } catch (err) {
      // Stay open on failure so what was just typed isn't lost, and let the
      // button work again. The caller has already shown the toast.
      console.error("[schedule:save]", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={!allowTimes ? "Move to another day" : target?.current ? "Reschedule" : "Schedule"}
    >
      <div className="space-y-4">
        <p className="text-sm text-txt2 break-words">{target?.label}</p>

        <div>
          <label htmlFor="sched-day" className="block text-xs text-txt3 mb-1.5">Day</label>
          <input
            id="sched-day"
            type="date"
            value={dayLabel}
            onChange={(e) => setDayLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(commit(), "schedule:save"); }}
            className="w-full glass-field px-3 py-2 text-txt text-sm"
          />
          {/*
            Moving a task to another day is a reschedule, not a silent edit:
            the entry stays on its original day, greyed out, so the stats can
            still show that it moved. Saying so here is the only place the
            user finds out.
          */}
          {dayChanged && (
            <p className="text-[10px] text-amber mt-1">
              Moves it to {dayLabel}. The old day keeps a greyed-out entry
              showing it was rescheduled.
            </p>
          )}
        </div>

        {allowTimes && <div className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="sched-start" className="block text-xs text-txt3 mb-1.5">Starts</label>
            <input
              id="sched-start"
              type="time"
              step={300}
              value={startLabel}
              onChange={(e) => {
                const next = e.target.value;
                setStartLabel(next);
                // Keep the length when you move the start — that's what people
                // mean by "actually, make it 3pm", not "make it shorter".
                const s = labelToMinutes(next);
                const oldS = labelToMinutes(startLabel);
                const oldE = labelToMinutes(endLabel);
                if (s !== null && oldS !== null && oldE !== null && oldE > oldS) {
                  setEndLabel(minutesToLabel(Math.min(DAY_MINUTES, s + (oldE - oldS))));
                }
              }}
              onKeyDown={(e) => { if (e.key === "Enter") run(commit(), "schedule:save"); }}
              className="w-full glass-field px-3 py-2 text-txt text-sm"
              autoFocus
            />
          </div>
          <span className="pb-2.5 text-txt3">–</span>
          <div className="flex-1">
            <label htmlFor="sched-end" className="block text-xs text-txt3 mb-1.5">Ends</label>
            <input
              id="sched-end"
              type="time"
              step={300}
              value={endLabel}
              onChange={(e) => setEndLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") run(commit(), "schedule:save"); }}
              className="w-full glass-field px-3 py-2 text-txt text-sm"
            />
          </div>
        </div>}

        <div className="flex items-center gap-2 text-xs min-h-[1.25rem]" aria-live="polite">
          {problem ? (
            <span className="text-danger">{problem}</span>
          ) : allowTimes ? (
            <>
              <Clock size={12} className="text-txt3 shrink-0" />
              <span className="text-txt2">{formatDuration(duration ?? 0)} blocked out</span>
              {/* The estimate is shown for context only. A gap between the two
                  is information, not a mistake to be corrected. */}
              {target?.estMinutes ? (
                <span className="text-txt3">
                  · estimate is {formatDuration(target.estMinutes)}
                </span>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex justify-between gap-2 pt-2">
          {target?.current && allowTimes ? (
            <button
              onClick={async () => { if (target) { await onClear(target.id); onClose(); } }}
              className="px-3 py-2 rounded-lg text-sm text-txt3 hover:text-danger hover:bg-surface3 transition-colors"
            >
              Remove time
            </button>
          ) : <span />}

          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3">Cancel</button>
            <button
              onClick={() => run(commit(), "schedule:save")}
              disabled={!!problem || saving}
              className="px-4 py-2 rounded-lg text-sm bg-violet text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
