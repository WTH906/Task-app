"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WeekTask } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  type Block, DAY_MINUTES, MIN_BLOCK_MINUTES, DEFAULT_BLOCK_MINUTES, DEFAULT_DAY_START,
  hasBlock, snap, clampBlock, resizeBlock, layoutBlocks,
  minutesToLabel, formatDuration, nowMinute,
} from "@/lib/schedule";
import { run } from "@/lib/db-helpers";
import { Clock, GripVertical } from "lucide-react";

/**
 * The hour grid.
 *
 * Two panes: everything on this day that has no time yet, and the day laid
 * out by the hour. You drag left to right to give something a time.
 *
 * Four gestures, all landing on the same pair of columns in the database:
 *
 *   drag a task onto the grid    → schedule it, length borrowed from its
 *                                  estimate (borrowed, never written back —
 *                                  see lib/schedule.ts)
 *   drag a block within the grid → move it, keeping its length
 *   drag a block's top or bottom → change when it starts or ends
 *   drag down empty grid         → sketch a slot and name a new task in it
 *
 * The picker modal does all of it with the keyboard, and is the only route
 * for blocks under half an hour, which are too short to hold edge handles.
 *
 * All four are mouse gestures. Touch falls back to the picker.
 */

/** 48px per hour reads well without making the day absurdly tall. */
const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;

const minuteToPx = (m: number) => m * PX_PER_MIN;
const pxToMinute = (px: number) => px / PX_PER_MIN;

/** Gutter reserved for the hour labels down the left. */
const LABEL_W = "3rem";
/** The space blocks actually get: everything but the labels and a right margin. */
const TRACK = `(100% - ${LABEL_W} - 0.5rem)`;

type DragPayload =
  | { kind: "schedule"; id: string; length: number }
  | { kind: "move"; id: string; length: number; grabOffsetPx: number };

export interface DayGridProps {
  tasks: WeekTask[];
  isToday: boolean;
  /** The day's accent colour, from DAY_COLORS. */
  color: string;
  projectColorById: Record<string, string>;
  projectTitleById: Record<string, string>;
  /** Estimate in minutes for a planner row, when it maps to a project task. */
  estimateFor: (task: WeekTask) => number | null;
  onToggleDone: (task: WeekTask) => void;
  onSetBlock: (taskId: string, block: Block) => void | Promise<void>;
  onClearBlock: (taskId: string) => void | Promise<void>;
  /** Open the precise picker for this row. */
  onOpenPicker: (task: WeekTask) => void;
  /** Create a brand-new planner row already sitting in this slot. */
  onCreateInSlot: (text: string, block: Block) => void | Promise<void>;
  onDelete: (taskId: string) => void;
  stripTag: (task: WeekTask) => string;
}

export function DayGrid({
  tasks, isToday, color, projectColorById, projectTitleById,
  estimateFor, onToggleDone, onSetBlock, onClearBlock, onOpenPicker,
  onCreateInSlot, onDelete, stripTag,
}: DayGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragPayload | null>(null);

  const [dropMinute, setDropMinute] = useState<number | null>(null);
  const [sketch, setSketch] = useState<Block | null>(null);
  const [pendingSlot, setPendingSlot] = useState<Block | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [now, setNow] = useState(() => nowMinute());

  // Rows moved to another day are excluded from both panes. The planner keeps
  // them, greyed out, as the record that you rescheduled — drawing a solid
  // block for one would show a commitment that has already moved, and count
  // it in the day's total.
  const live = useMemo(() => tasks.filter((t) => !t.rescheduled_to), [tasks]);
  const scheduled = useMemo(() => live.filter(hasBlock), [live]);
  const unscheduled = useMemo(() => live.filter((t) => !hasBlock(t)), [live]);

  /**
   * Clusters the user has asked to see in full, keyed by their start minute.
   *
   * The three-column cap keeps a crowded afternoon readable, but withholding
   * a block entirely made that task unreachable: not tickable, not movable,
   * not openable — its only recovery route was the project page. Clicking the
   * "+N" chip lifts the cap for that cluster instead.
   */
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  /**
   * The block being dragged by an edge, if any, at its live size.
   *
   * Feeding this into the layout below rather than special-casing it at
   * render time is what makes the neighbouring blocks re-flow into columns
   * while you drag: `layoutBlocks` simply sees the new size and repacks. It
   * also means the block's own time label follows the drag for free.
   */
  const [resizePreview, setResizePreview] = useState<{ id: string; block: Block } | null>(null);

  const blocksForLayout = useMemo(
    () => scheduled.map((t) => ({
      item: t,
      block: resizePreview && resizePreview.id === t.id
        ? resizePreview.block
        : { start: t.start_minute as number, end: t.end_minute as number },
    })),
    [scheduled, resizePreview]
  );

  const laid = useMemo(
    // A generous ceiling rather than none at all — past this the columns are
    // too narrow to hold a word, and the chip is the better answer.
    () => layoutBlocks(blocksForLayout, 99),
    [blocksForLayout]
  );

  /** Re-run with the cap on, so only un-expanded clusters are collapsed. */
  const capped = useMemo(() => layoutBlocks(blocksForLayout, 3), [blocksForLayout]);

  /** Blocks to draw: expanded clusters use the uncapped layout. */
  const visible = useMemo(() => {
    const expandedStarts = capped.overflow
      .filter((o) => expanded.has(o.start))
      .map((o) => o.start);
    if (expandedStarts.length === 0) return capped.placed.filter((p) => !p.hidden);

    const byId = new Map(laid.placed.map((p) => [p.item.id, p]));
    return capped.placed
      .map((p) => {
        // Anything inside an expanded cluster is taken from the uncapped
        // layout, which gives it a real column instead of hiding it.
        const inExpanded = capped.overflow.some(
          (o) => expanded.has(o.start) && p.block.start < o.end && o.start < p.block.end
        );
        return inExpanded ? (byId.get(p.item.id) ?? p) : p;
      })
      .filter((p) => !p.hidden);
  }, [capped, laid, expanded]);

  /**
   * Time still committed on this day. Finished work is excluded — the number
   * is meant to answer "how much have I got left", not "how much did I put in
   * the calendar", so a day you've worked through shouldn't still read 7h.
   */
  const blockedMinutes = useMemo(
    () => scheduled.filter((t) => !t.done)
      .reduce((s, t) => s + ((t.end_minute ?? 0) - (t.start_minute ?? 0)), 0),
    [scheduled]
  );

  // The now-line only ticks on today, and only once a minute — it moves less
  // than a pixel in that time, so anything faster is wasted renders.
  useEffect(() => {
    if (!isToday) return;
    const iv = setInterval(() => setNow(nowMinute()), 60_000);
    return () => clearInterval(iv);
  }, [isToday]);

  // Open somewhere useful. A grid that starts at 00:00 shows eight hours of
  // nothing, and on today the interesting part is where you are.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = isToday ? Math.max(0, now - 90) : DEFAULT_DAY_START;
    el.scrollTop = minuteToPx(target);
    // Once, on mount — re-running would yank the view back while scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pointer Y (viewport) → minute of the day, snapped. */
  const yToMinute = (clientY: number, offsetPx = 0) => {
    const el = canvasRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return snap(pxToMinute(clientY - rect.top - offsetPx));
  };

  // ── Drag and drop ─────────────────────────────────────────────────────

  const onGridDragOver = (e: React.DragEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const p = dragRef.current;
    const offset = p.kind === "move" ? p.grabOffsetPx : 0;
    setDropMinute(Math.max(0, Math.min(DAY_MINUTES - p.length, yToMinute(e.clientY, offset))));
  };

  const onGridDrop = (e: React.DragEvent) => {
    const p = dragRef.current;
    dragRef.current = null;
    setDropMinute(null);
    if (!p) return;
    e.preventDefault();

    // Same clamp the preview used. Without it, dropping a 60-minute task at
    // 23:40 previewed 23:00–00:00 and then saved 23:45–00:00 — the block
    // silently shrank and landed somewhere other than where it was shown.
    const offset = p.kind === "move" ? p.grabOffsetPx : 0;
    const start = Math.max(0, Math.min(DAY_MINUTES - p.length, yToMinute(e.clientY, offset)));
    run(onSetBlock(p.id, clampBlock(start, start + p.length)), "grid:set-block");
  };

  // ── Drag on empty grid to sketch a new slot ───────────────────────────

  const sketchAnchor = useRef<number | null>(null);
  /** Latest sketch, readable synchronously from the window listeners. */
  const sketchRef = useRef<Block | null>(null);

  const setSketchBoth = (b: Block | null) => {
    sketchRef.current = b;
    setSketch(b);
  };

  /**
   * Listeners are attached imperatively from mousedown rather than through an
   * effect. An effect only runs after the next commit, so a fast click could
   * release the button before `mouseup` was being listened for and leave the
   * sketch stuck to the cursor.
   */
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    // Only the empty background starts a sketch — otherwise mousedown on a
    // block would fight its own HTML5 drag.
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;

    const anchor = yToMinute(e.clientY);
    sketchAnchor.current = anchor;
    // Clamped from the very first frame: a click on the last few pixels of
    // the grid gives 24:00, and an unclamped 24:00–24:15 is a block the
    // database rejects outright.
    setSketchBoth(clampBlock(anchor, anchor + MIN_BLOCK_MINUTES));

    const move = (ev: MouseEvent) => {
      const a = sketchAnchor.current;
      if (a === null) return;
      // The button can be released outside the window (over devtools, off the
      // screen edge) and no mouseup ever arrives. Treat "no buttons held" as
      // the release rather than following the cursor forever.
      if (ev.buttons === 0) { finish(); return; }
      const m = yToMinute(ev.clientY);
      setSketchBoth(clampBlock(Math.min(a, m), Math.max(a, m)));
    };

    const finish = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      if (sketchAnchor.current === null) return;
      sketchAnchor.current = null;

      // Read the sketch from the ref, not from inside a setState updater —
      // updaters must be pure and React may run them more than once.
      const s = sketchRef.current;
      setSketchBoth(null);
      if (s && s.end - s.start >= MIN_BLOCK_MINUTES) {
        setPendingSlot(s);
        setPendingText("");
      }
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish);
  };

  // If the component unmounts mid-drag, don't leave listeners behind.
  useEffect(() => () => { sketchAnchor.current = null; }, []);

  // ── Resize: dragging a block's top or bottom edge ─────────────────────

  /** Live preview, readable synchronously from the window listeners. */
  const resizeRef = useRef<{ id: string; block: Block } | null>(null);

  const setResizeBoth = (v: { id: string; block: Block } | null) => {
    resizeRef.current = v;
    setResizePreview(v);
  };

  /**
   * Start an edge drag.
   *
   * Listeners go on imperatively, as with the sketch: an effect only runs
   * after the next commit, so a quick drag could finish before `mouseup` was
   * being listened for and leave the block stuck to the cursor.
   */
  const startResize = (e: React.MouseEvent, task: WeekTask, origin: Block, edge: "start" | "end") => {
    if (e.button !== 0) return;
    // Both are needed: stopPropagation keeps the canvas from starting a
    // sketch underneath, preventDefault stops the parent block — which is
    // `draggable` — from beginning an HTML5 move drag from the handle.
    e.stopPropagation();
    e.preventDefault();

    setResizeBoth({ id: task.id, block: origin });

    const move = (ev: MouseEvent) => {
      if (ev.buttons === 0) { finish(); return; }
      const minute = yToMinute(ev.clientY);
      setResizeBoth({ id: task.id, block: resizeBlock(origin, edge, minute) });
    };

    const finish = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      const final = resizeRef.current;
      setResizeBoth(null);
      if (!final) return;
      // Only write when it actually changed — a stray click on a handle
      // shouldn't cost a round trip.
      if (final.block.start === origin.start && final.block.end === origin.end) return;
      run(onSetBlock(task.id, clampBlock(final.block.start, final.block.end)), "grid:resize");
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish);
  };

  // ── Render ────────────────────────────────────────────────────────────

  const hours = Array.from({ length: 25 }, (_, h) => h);

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* ── Unscheduled ──────────────────────────────────────────────── */}
      <div className="lg:w-72 shrink-0">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-[11px] uppercase tracking-wider text-txt3">
            Not scheduled
          </h2>
          <span className="text-[10px] text-txt3 font-mono">{unscheduled.length}</span>
        </div>

        {unscheduled.length === 0 ? (
          <p className="text-xs text-txt3 border border-dashed border-border rounded-lg px-3 py-6 text-center">
            {tasks.length === 0
              ? "Nothing on this day yet."
              : "Everything here has a time."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {unscheduled.map((t) => {
              const est = estimateFor(t);
              return (
                <div
                  key={t.id}
                  draggable
                  onDragStart={(e) => {
                    dragRef.current = {
                      kind: "schedule",
                      id: t.id,
                      length: Math.max(MIN_BLOCK_MINUTES, snap(est && est > 0 ? est : DEFAULT_BLOCK_MINUTES)),
                    };
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", t.id);
                  }}
                  onDragEnd={() => { dragRef.current = null; setDropMinute(null); }}
                  className="group flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-2 text-xs cursor-grab card-float"
                  style={t.project_id && projectColorById[t.project_id]
                    ? { borderLeftWidth: 3, borderLeftColor: projectColorById[t.project_id] }
                    : undefined}
                  title={t.project_id ? projectTitleById[t.project_id] : undefined}
                >
                  <GripVertical size={12} className="text-txt3 shrink-0" aria-hidden />
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={() => onToggleDone(t)}
                    style={{ accentColor: color }}
                    className="shrink-0"
                    aria-label={`Mark ${stripTag(t)} ${t.done ? "not done" : "done"}`}
                  />
                  <span className={cn("flex-1 leading-snug", t.done && "line-through text-txt3 opacity-60")}>
                    {t.subtask_id && <span className="text-txt3 mr-1" aria-hidden>↳</span>}
                    {stripTag(t)}
                  </span>
                  {est ? (
                    <span className="text-[10px] text-txt3 font-mono shrink-0">{formatDuration(est)}</span>
                  ) : null}
                  <button
                    onClick={() => onOpenPicker(t)}
                    title="Give this a time"
                    aria-label={`Schedule ${stripTag(t)}`}
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-txt3 hover:text-violet2 hover:bg-surface2 transition-colors"
                  >
                    <Clock size={13} />
                  </button>
                  {/* The plain list this replaces had a delete control. Without
                      one here, switching the scheduler on would remove the only
                      way to delete a planner row from the day page. */}
                  <button
                    onClick={() => onDelete(t.id)}
                    title="Remove from this day"
                    aria-label={`Remove ${stripTag(t)}`}
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-txt3 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger transition-all"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-txt3 mt-3 leading-relaxed">
          Drag onto the grid to give it a time, or use the clock button.
          Blocks are as long as the task&apos;s estimate — changing one
          doesn&apos;t change the estimate.
        </p>
      </div>

      {/* ── Hour grid ────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-[11px] uppercase tracking-wider text-txt3">Day</h2>
          {blockedMinutes > 0 && (
            <span className="text-[10px] text-txt3 font-mono">
              {formatDuration(blockedMinutes)} blocked
            </span>
          )}
        </div>

        <div
          ref={scrollRef}
          className="relative border border-border rounded-lg bg-surface overflow-y-auto"
          style={{ height: "min(64vh, 640px)" }}
        >
          <div
            ref={canvasRef}
            onDragOver={onGridDragOver}
            onDrop={onGridDrop}
            // Only when the pointer actually leaves the canvas. Blocks are
            // event targets, so without the containment check the preview
            // flickered off every time you dragged across one.
            onDragLeave={(e) => {
              const to = e.relatedTarget as Node | null;
              if (!to || !e.currentTarget.contains(to)) setDropMinute(null);
            }}
            onMouseDown={onCanvasMouseDown}
            className="relative"
            style={{ height: minuteToPx(DAY_MINUTES) }}
          >
            {/* Hour lines + labels */}
            {hours.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-border/60 pointer-events-none"
                style={{ top: minuteToPx(h * 60) }}
              >
                <span className="absolute -top-2 left-1 text-[10px] font-mono text-txt3 bg-surface px-1">
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            ))}

            {/* Half-hour ticks, lighter */}
            {hours.slice(0, 24).map((h) => (
              <div
                key={`half-${h}`}
                className="absolute left-12 right-0 border-t border-border/25 pointer-events-none"
                style={{ top: minuteToPx(h * 60 + 30) }}
              />
            ))}

            {/* Now line */}
            {isToday && (
              <div
                className="absolute left-0 right-0 pointer-events-none z-20"
                style={{ top: minuteToPx(now) }}
              >
                <div className="h-px" style={{ backgroundColor: "#e05555" }} />
                <div
                  className="absolute -top-1 left-0 w-2 h-2 rounded-full"
                  style={{ backgroundColor: "#e05555" }}
                />
              </div>
            )}

            {/* Sketch preview while dragging on empty space */}
            {sketch && (
              <div
                className="absolute left-12 right-2 rounded border-2 border-dashed pointer-events-none z-10"
                style={{
                  top: minuteToPx(sketch.start),
                  height: minuteToPx(sketch.end - sketch.start),
                  borderColor: color,
                  background: `${color}18`,
                }}
              >
                <span className="text-[10px] font-mono px-1" style={{ color }}>
                  {minutesToLabel(sketch.start)}–{minutesToLabel(sketch.end)}
                </span>
              </div>
            )}

            {/* Drop preview while dragging a task in */}
            {dropMinute !== null && dragRef.current && (
              <div
                className="absolute left-12 right-2 rounded border-2 border-dashed pointer-events-none z-10 opacity-70"
                style={{
                  top: minuteToPx(dropMinute),
                  height: minuteToPx(dragRef.current.length),
                  borderColor: "var(--accent2)",
                  background: "color-mix(in srgb, var(--accent) 15%, transparent)",
                }}
              >
                <span className="text-[10px] font-mono px-1 text-violet2">
                  {minutesToLabel(dropMinute)}
                </span>
              </div>
            )}

            {/* Blocks */}
            {visible.map((p) => {
              const t = p.item;
              const accent = (t.project_id && projectColorById[t.project_id]) || color;
              const short = p.block.end - p.block.start < 45;
              const isResizing = resizePreview?.id === t.id;
              // Two 5px handles need somewhere to live. Below half an hour a
              // block is 24px tall and they'd swallow it whole, so those keep
              // the picker as their only way to change length.
              const canResize = p.block.end - p.block.start >= 30;
              return (
                <div
                  key={t.id}
                  // Not draggable mid-resize: an HTML5 move drag starting from
                  // under the cursor would fight the edge drag for the same
                  // pointer.
                  draggable={!isResizing}
                  onDragStart={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    dragRef.current = {
                      kind: "move",
                      id: t.id,
                      length: p.block.end - p.block.start,
                      // Keep the point you grabbed under the cursor, so the
                      // block doesn't jump when you pick it up mid-way down.
                      grabOffsetPx: e.clientY - rect.top,
                    };
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", t.id);
                  }}
                  onDragEnd={() => { dragRef.current = null; setDropMinute(null); }}
                  onDoubleClick={() => onOpenPicker(t)}
                  className={cn(
                    "absolute rounded-md border overflow-hidden cursor-grab group",
                    t.done && "opacity-50",
                    // Lift the block being dragged above its neighbours so the
                    // edge you're pulling isn't hidden under the next column.
                    isResizing && "z-30 shadow-lg"
                  )}
                  style={{
                    top: minuteToPx(p.block.start),
                    height: Math.max(minuteToPx(p.block.end - p.block.start), 16),
                    // Columns divide the space LEFT OVER after the hour
                    // labels, not the full width. Taking a percentage of
                    // 100% and then adding the 3rem label offset pushed the
                    // rightmost column past the edge of the scroll box —
                    // invisible at one lane, 24px of overflow at three.
                    // TRACK below is that leftover space.
                    left: `calc(${LABEL_W} + ${TRACK} * ${p.lane} / ${p.lanes})`,
                    width: `calc(${TRACK} / ${p.lanes} - 0.25rem)`,
                    borderColor: accent,
                    background: `color-mix(in srgb, ${accent} 22%, var(--surface2))`,
                  }}
                  title={`${minutesToLabel(p.block.start)}–${minutesToLabel(p.block.end)} · ${stripTag(t)}${
                    t.project_id ? ` · ${projectTitleById[t.project_id] ?? ""}` : ""
                  }`}
                >
                  <div className={cn("flex items-start gap-1.5 px-1.5", short ? "py-0" : "py-1")}>
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => onToggleDone(t)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ accentColor: color }}
                      className="shrink-0 mt-0.5"
                      aria-label={`Mark ${stripTag(t)} ${t.done ? "not done" : "done"}`}
                    />
                    <span className={cn(
                      "text-[11px] leading-tight flex-1 min-w-0",
                      t.done && "line-through"
                    )}>
                      {t.subtask_id && <span className="opacity-60 mr-0.5" aria-hidden>↳</span>}
                      {stripTag(t)}
                      <span className={cn(
                        "text-[9px] font-mono ml-1 whitespace-nowrap",
                        isResizing ? "opacity-100 font-bold" : "opacity-60"
                      )}>
                        {minutesToLabel(p.block.start)}–{minutesToLabel(p.block.end)}
                        {isResizing && (
                          <span className="ml-1 opacity-70">
                            ({formatDuration(p.block.end - p.block.start)})
                          </span>
                        )}
                      </span>
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenPicker(t); }}
                      aria-label={`Change the time for ${stripTag(t)}`}
                      className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 text-txt3 hover:text-txt transition-opacity"
                    >
                      <Clock size={11} />
                    </button>
                  </div>

                  {/*
                    Edge handles. Thin strips pinned to the top and bottom, in
                    the style of every calendar: grab and pull. They sit above
                    the block's own content so a drag started on the title
                    still moves the block instead.

                    Resizing changes how much time is SET ASIDE. It does not
                    touch the task's estimate — see resizeBlock().
                  */}
                  {canResize && !t.done && (
                    <>
                      <div
                        onMouseDown={(e) => startResize(e, t, p.block, "start")}
                        title="Drag to change when it starts"
                        className={cn(
                          "absolute top-0 left-0 right-0 h-[5px] cursor-ns-resize transition-opacity",
                          isResizing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                        style={{ background: accent }}
                      />
                      <div
                        onMouseDown={(e) => startResize(e, t, p.block, "end")}
                        title="Drag to change when it ends"
                        className={cn(
                          "absolute bottom-0 left-0 right-0 h-[5px] cursor-ns-resize transition-opacity",
                          isResizing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                        style={{ background: accent }}
                      />
                    </>
                  )}
                </div>
              );
            })}

            {/*
              Too crowded to draw side by side. The chip is a BUTTON, not a
              label: hiding a task with no way to reach it would strand it.
            */}
            {capped.overflow.map((o) => {
              const isOpen = expanded.has(o.start);
              return (
                <button
                  key={`ov-${o.start}`}
                  onClick={() => setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(o.start)) next.delete(o.start); else next.add(o.start);
                    return next;
                  })}
                  className="absolute right-2 z-20 text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface3 text-txt2 border border-border hover:text-txt hover:border-border2 transition-colors"
                  style={{ top: minuteToPx(o.start) + 2 }}
                  title={isOpen
                    ? "Show only three columns here"
                    : `${o.count} more overlap here — click to show them all`}
                >
                  {isOpen ? "− fewer" : `+${o.count}`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Naming the slot you just sketched */}
        {pendingSlot && (
          <div className="mt-2 flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2">
            <span className="text-[10px] font-mono text-txt3 shrink-0">
              {minutesToLabel(pendingSlot.start)}–{minutesToLabel(pendingSlot.end)}
            </span>
            <input
              autoFocus
              value={pendingText}
              onChange={(e) => setPendingText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setPendingSlot(null); setPendingText(""); }
                if (e.key === "Enter" && pendingText.trim()) {
                  run(onCreateInSlot(pendingText.trim(), pendingSlot), "grid:create-in-slot");
                  setPendingSlot(null);
                  setPendingText("");
                }
              }}
              placeholder="What goes here?"
              className="flex-1 bg-transparent text-sm text-txt placeholder-txt3 focus:outline-none"
            />
            <button
              onClick={() => { setPendingSlot(null); setPendingText(""); }}
              className="text-xs text-txt3 hover:text-txt shrink-0"
            >
              Cancel
            </button>
          </div>
        )}

        <p className="text-[10px] text-txt3 mt-2">
          Drag down an empty stretch to sketch a slot. Double-click a block to
          change its times.
        </p>
      </div>
    </div>
  );
}
