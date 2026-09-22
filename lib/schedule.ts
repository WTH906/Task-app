/**
 * Time blocks — scheduling a planner entry between two hours.
 *
 * ── What a block is, and what it is not ────────────────────────────────
 *
 * A block is when you have set time ASIDE for something. It is a property
 * of your day.
 *
 * `est_minutes` is how long the work takes. It is a property of the work,
 * kept so you can look it up when you plan something similar later.
 *
 * These are different facts and they are allowed to disagree — a 90-minute
 * task can sit in a two-hour slot because you left buffer, or because
 * that's the only window something else allows. So nothing here ever
 * writes back to `est_minutes`; the estimate is used once, as a starting
 * guess in the picker, and then forgotten.
 *
 * ── Units ──────────────────────────────────────────────────────────────
 *
 * Minutes from local midnight, 0–1440. Not a timestamp: a local day is
 * always 0–1440 in wall-clock terms, including the two days a year clocks
 * change, whereas a TIMESTAMPTZ would drag UTC conversion into a value
 * that has no business knowing about timezones. It is also what the grid
 * needs for layout, so nothing converts on render.
 */

export const DAY_MINUTES = 1440;

/** Snap granularity for dragging and for the picker's defaults. */
export const SLOT_MINUTES = 15;

/** Used when a task has no estimate to borrow a duration from. */
export const DEFAULT_BLOCK_MINUTES = 60;

/** Shortest block the grid can render legibly. */
export const MIN_BLOCK_MINUTES = 15;

/** Where the day grid starts scrolled to, when nothing says otherwise. */
export const DEFAULT_DAY_START = 8 * 60;

export interface Block {
  start: number;
  end: number;
}

/** Does this row have a time on it? Both columns move together (see v24). */
export function hasBlock(row: { start_minute?: number | null; end_minute?: number | null }): boolean {
  return typeof row.start_minute === "number" && typeof row.end_minute === "number";
}

// ─── Formatting ─────────────────────────────────────────────────────────

/** 540 → "09:00". 24h, because a grid needs a fixed-width label. */
export function minutesToLabel(m: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, Math.round(m)));
  const h = Math.floor(clamped / 60);
  const min = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * "09:00" → 540. Returns null for anything that isn't a real time, so a
 * half-typed value in the picker doesn't become 0 (midnight) by accident.
 */
export function labelToMinutes(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  const total = h * 60 + min;
  return total > DAY_MINUTES ? null : total;
}

/** 90 → "1h 30m". 60 → "1h". 45 → "45m". */
export function formatDuration(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  if (rest === 0) return `${h}h`;
  return `${h}h ${rest}m`;
}

/** "09:00 – 10:30 · 1h 30m" */
export function describeBlock(b: Block): string {
  return `${minutesToLabel(b.start)} – ${minutesToLabel(b.end)} · ${formatDuration(b.end - b.start)}`;
}

// ─── Arithmetic ─────────────────────────────────────────────────────────

export function snap(minutes: number, step: number = SLOT_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/**
 * Force a start/end pair into something the database will accept: inside
 * the day, at least one slot long, and in the right order.
 *
 * The v24 CHECK constraint enforces the same rule. This is here so the UI
 * never *offers* an invalid block, not as the only line of defence —
 * dragging near the bottom of the grid is exactly how you'd otherwise
 * produce a block ending at 25:00.
 */
export function clampBlock(start: number, end: number): Block {
  let s = Math.max(0, Math.min(DAY_MINUTES - MIN_BLOCK_MINUTES, Math.round(start)));
  let e = Math.round(end);

  // Order matters. Pulling the start back into the day can leave it further
  // from the end than it was, so the minimum length has to be enforced
  // AFTER that, not before — clamping (1435, 1436) the other way around
  // produced an 11-minute block that looked fine and rendered as a sliver.
  if (e < s + MIN_BLOCK_MINUTES) e = s + MIN_BLOCK_MINUTES;

  if (e > DAY_MINUTES) {
    e = DAY_MINUTES;
    s = Math.min(s, e - MIN_BLOCK_MINUTES);
  }

  return { start: s, end: e };
}

/** Move a block to a new start, keeping its length and staying in the day. */
export function moveBlock(b: Block, newStart: number): Block {
  const length = b.end - b.start;
  const s = Math.max(0, Math.min(DAY_MINUTES - length, Math.round(newStart)));
  return { start: s, end: s + length };
}

/**
 * Drag one edge of a block. The opposite edge stays where it is.
 *
 * The edge being dragged can't cross the other one, so pulling the bottom up
 * past the start stops at the minimum length rather than inverting the block
 * or collapsing it to nothing. Both branches return something the v24 CHECK
 * constraint accepts, which matters because this runs on every mousemove and
 * only the last value is written.
 *
 * Note what this does NOT do: touch the task's estimate. A block's length is
 * how much time you set aside; `est_minutes` is how long the work takes, kept
 * so you can look it up when planning something similar. Dragging an edge to
 * make room in an afternoon must not rewrite that.
 */
export function resizeBlock(b: Block, edge: "start" | "end", minute: number): Block {
  if (edge === "start") {
    const s = Math.max(0, Math.min(b.end - MIN_BLOCK_MINUTES, Math.round(minute)));
    return { start: s, end: b.end };
  }
  const e = Math.min(DAY_MINUTES, Math.max(b.start + MIN_BLOCK_MINUTES, Math.round(minute)));
  return { start: b.start, end: e };
}

export function blocksOverlap(a: Block, b: Block): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * A sensible first guess for the picker.
 *
 * Length comes from the task's estimate when it has one — that is the ONLY
 * place the estimate is consulted, and it is never written back, so
 * changing the block later can't corrupt a number you keep in order to
 * plan similar work in future.
 *
 * Placement goes after whatever is already on that day, so scheduling three
 * things in a row doesn't stack them all on top of each other. If the day
 * is empty it starts at 09:00.
 */
export function suggestBlock(
  estMinutes: number | null | undefined,
  existing: Block[],
  now?: { isToday: boolean; minute: number }
): Block {
  const length = Math.max(
    MIN_BLOCK_MINUTES,
    snap(estMinutes && estMinutes > 0 ? estMinutes : DEFAULT_BLOCK_MINUTES)
  );

  // Where we'd like to begin: after everything already on the day, or the
  // next quarter hour if it's today and the day is empty (09:00 is a silly
  // suggestion at 3pm).
  let start = 9 * 60;
  if (existing.length > 0) {
    start = snap(Math.max(...existing.map((b) => b.end)));
  } else if (now?.isToday) {
    start = snap(now.minute + SLOT_MINUTES);
  }

  // If that doesn't leave room before midnight, fall back to the first gap
  // that fits. Stacking after a 22:00–23:00 block used to suggest 23:00 for a
  // 90-minute task, which clampBlock then silently truncated to 15 minutes.
  if (start + length > DAY_MINUTES) {
    const sorted = [...existing].sort((a, b) => a.start - b.start);
    let cursor = now?.isToday ? snap(now.minute) : 0;
    let found: number | null = null;
    for (const b of sorted) {
      if (b.start - cursor >= length) { found = cursor; break; }
      cursor = Math.max(cursor, b.end);
    }
    if (found === null && cursor + length <= DAY_MINUTES) found = cursor;
    // Nothing fits anywhere: keep it inside the day and let the user adjust,
    // rather than proposing something the database would reject.
    start = found ?? Math.max(0, DAY_MINUTES - length);
  }

  return clampBlock(start, start + length);
}

// ─── Overlap layout ─────────────────────────────────────────────────────

export interface LaidOut<T> {
  item: T;
  block: Block;
  /** Column index within its cluster. */
  lane: number;
  /** How many columns the cluster is split into. */
  lanes: number;
  /** True when the cluster is too crowded to draw this one. */
  hidden: boolean;
}

export interface LayoutResult<T> {
  placed: LaidOut<T>[];
  /** One entry per over-crowded cluster, for the "+N more" marker. */
  overflow: Array<{ start: number; end: number; count: number }>;
}

/**
 * Pack overlapping blocks into side-by-side columns.
 *
 * Deliberately capped. Column packing is the part of an hour grid that
 * grows teeth: at five overlapping tasks each column is too narrow to read
 * a word of, so the "correct" layout is less useful than admitting defeat.
 * Past `maxLanes` the extra blocks are withheld and reported as a count
 * instead, which the grid renders as a "+N more" chip.
 */
export function layoutBlocks<T>(
  items: Array<{ item: T; block: Block }>,
  maxLanes = 3
): LayoutResult<T> {
  const sorted = [...items].sort(
    (a, b) => a.block.start - b.block.start || a.block.end - b.block.end
  );

  const placed: LaidOut<T>[] = [];
  const overflow: LayoutResult<T>["overflow"] = [];

  let i = 0;
  while (i < sorted.length) {
    // Grow a cluster: everything that transitively overlaps.
    const cluster = [sorted[i]];
    let clusterEnd = sorted[i].block.end;
    let j = i + 1;
    while (j < sorted.length && sorted[j].block.start < clusterEnd) {
      cluster.push(sorted[j]);
      clusterEnd = Math.max(clusterEnd, sorted[j].block.end);
      j++;
    }

    // Assign each block the first column free at its start time.
    const laneEnds: number[] = [];
    const assigned: number[] = [];
    for (const entry of cluster) {
      let lane = laneEnds.findIndex((end) => end <= entry.block.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(entry.block.end);
      } else {
        laneEnds[lane] = entry.block.end;
      }
      assigned.push(lane);
    }

    const lanes = Math.min(laneEnds.length, maxLanes);
    let hiddenCount = 0;
    cluster.forEach((entry, k) => {
      const lane = assigned[k];
      const hidden = lane >= maxLanes;
      if (hidden) hiddenCount++;
      placed.push({ item: entry.item, block: entry.block, lane, lanes, hidden });
    });

    if (hiddenCount > 0) {
      overflow.push({
        start: cluster[0].block.start,
        end: clusterEnd,
        count: hiddenCount,
      });
    }

    i = j;
  }

  return { placed, overflow };
}

/** Minutes since local midnight, right now. */
export function nowMinute(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}
