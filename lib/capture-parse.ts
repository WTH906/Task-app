import { formatDate, addDays } from "./utils";

/**
 * Lightweight natural-language parsing for quick capture.
 *
 * The point of quick capture is that it costs under two seconds and asks no
 * questions. Typing "call accountant tomorrow p1" should not then require
 * touching a date picker — so we pull the obvious bits out of the sentence
 * and leave everything else alone.
 *
 * Deliberately conservative: if a phrase is ambiguous we do NOT consume it.
 * Silently mangling someone's task text is far worse than making them set a
 * date by hand.
 */

export interface ParsedCapture {
  name: string;
  dateKey: string | null;
  priority: number | null;
  /** Human-readable summary of what was consumed, for the input's hint line. */
  matched: string[];
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** Next occurrence of a weekday, always in the future (never today). */
function nextWeekday(from: Date, target: number): Date {
  const diff = (target - from.getDay() + 7) % 7;
  return addDays(from, diff === 0 ? 7 : diff);
}

export function parseCapture(input: string, now: Date = new Date()): ParsedCapture {
  let text = ` ${input} `;
  let dateKey: string | null = null;
  let priority: number | null = null;
  const matched: string[] = [];

  /**
   * Match, then let the caller decide whether to keep it.
   *
   * The text is NOT mutated until `accept()` is called, so a phrase that
   * matches the shape of a date but isn't a real one ("sync 8/20" where 20
   * isn't a month, "Book flight 29/2") stays in the task name instead of
   * being silently deleted from it.
   */
  const probe = (re: RegExp): { m: RegExpMatchArray; accept: () => void } | null => {
    const m = text.match(re);
    if (!m) return null;
    return { m, accept: () => { text = text.replace(re, " "); } };
  };

  const consume = (re: RegExp): RegExpMatchArray | null => {
    const hit = probe(re);
    if (!hit) return null;
    hit.accept();
    return hit.m;
  };

  /** Real calendar date? Rejects 2026-02-30, 31/04, and friends. */
  const isRealDate = (y: number, mo: number, d: number): boolean => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    const dt = new Date(y, mo - 1, d, 12, 0, 0);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  };

  // ── Priority: "p1".."p5" as a standalone token ──────────────────────────
  const pm = consume(/\s[pP]([1-5])(?=\s)/);
  if (pm) {
    priority = parseInt(pm[1], 10);
    matched.push(`priority ${priority}`);
  }

  // ── Explicit dates ──────────────────────────────────────────────────────
  // ISO first: 2026-08-20. Validated — an unchecked "2026-02-30" would be
  // written straight into a DATE column and rejected by Postgres, losing the
  // capture entirely.
  const isoHit = probe(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/);
  if (isoHit) {
    const [, yy, mm, dd] = isoHit.m;
    if (isRealDate(+yy, +mm, +dd)) {
      isoHit.accept();
      dateKey = `${yy}-${mm}-${dd}`;
      matched.push(dateKey);
    }
  }

  // Day/month, with optional year: 20/08, 20/08/2026, 20-8
  if (!dateKey) {
    const dmHit = probe(/\s(\d{1,2})[/](\d{1,2})(?:[/](\d{2,4}))?(?=\s)/);
    if (dmHit) {
      const dm = dmHit.m;
      const day = parseInt(dm[1], 10);
      const month = parseInt(dm[2], 10);
      let year = dm[3] ? parseInt(dm[3], 10) : now.getFullYear();
      if (year < 100) year += 2000;

      if (isRealDate(year, month, day)) {
        const d = new Date(year, month - 1, day, 12, 0, 0);
        // No year given and the date has already passed → assume next year,
        // but only if that's still a real date (29/2 isn't, every year).
        if (!dm[3] && d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
          if (!isRealDate(year + 1, month, day)) {
            // Leave it in the text rather than silently shifting the meaning.
            return finish();
          }
          d.setFullYear(year + 1);
        }
        dmHit.accept();
        dateKey = formatDate(d);
        matched.push(dateKey);
      }
      // Not a real date → not consumed, stays part of the task name.
    }
  }

  // ── Relative dates ──────────────────────────────────────────────────────
  if (!dateKey && consume(/\stoday(?=\s)/i)) {
    dateKey = formatDate(now);
    matched.push("today");
  }
  if (!dateKey && consume(/\stomorrow(?=\s)/i)) {
    dateKey = formatDate(addDays(now, 1));
    matched.push("tomorrow");
  }
  if (!dateKey) {
    const inDays = consume(/\sin\s(\d{1,3})\s(day|days|week|weeks)(?=\s)/i);
    if (inDays) {
      const n = parseInt(inDays[1], 10);
      const mult = /week/i.test(inDays[2]) ? 7 : 1;
      dateKey = formatDate(addDays(now, n * mult));
      matched.push(`in ${n} ${inDays[2].toLowerCase()}`);
    }
  }
  if (!dateKey) {
    // "next monday" / "monday" — both resolve to the next future occurrence.
    const wd = consume(/\s(?:next\s)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)(?=\s)/i);
    if (wd) {
      const target = WEEKDAYS[wd[1].toLowerCase()];
      dateKey = formatDate(nextWeekday(now, target));
      matched.push(wd[1].toLowerCase());
    }
  }
  if (!dateKey && consume(/\snext\sweek(?=\s)/i)) {
    dateKey = formatDate(addDays(now, 7));
    matched.push("next week");
  }

  return finish();

  function finish(): ParsedCapture {
    const name = text.replace(/\s+/g, " ").trim();
    // If parsing ate the whole thing, the user meant it literally.
    if (!name) {
      return { name: input.trim(), dateKey: null, priority: null, matched: [] };
    }
    return { name, dateKey, priority, matched };
  }
}
