"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { parseCapture } from "@/lib/capture-parse";
import { useToast } from "@/components/Toast";
import { useSettings } from "@/lib/hooks/useSettings";

/**
 * Quick capture.
 *
 * The whole point is that a thought costs under two seconds to record and
 * asks no questions. One field, no project picker, no date picker, no
 * priority selector — type, Enter, back to work. Deciding where it belongs
 * happens later, on the Task list, which is the triage surface.
 *
 * It writes to `quick_tasks`, which was already the app's inbox — the
 * destination existed, only the door was missing.
 *
 * Opens on:
 *   • "a" anywhere that isn't a text field
 *   • Ctrl/Cmd + Shift + A, which works even while typing
 */
export function QuickCapture({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { has } = useSettings();
  const enabled = has("quickCapture");

  const parsed = useMemo(() => parseCapture(value), [value]);

  // ── Global shortcut ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (
        el.tagName === "INPUT" || el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" || el.isContentEditable
      );

      // Modifier form works even mid-typing.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      // Don't hijack "a" while another dialog is up — the user is mid-task.
      if (document.querySelector('[role="dialog"], .glass-backdrop, .modal-backdrop')) return;
      if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  useEffect(() => {
    if (open) {
      setValue("");
      // Focus after paint so the keystroke that opened it isn't captured.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Capture phase + stopPropagation: other modals also listen for Escape on
    // document, so without this one keypress would close quick capture AND
    // the half-filled form underneath it.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("keydown", onEsc, true);
    return () => document.removeEventListener("keydown", onEsc, true);
  }, [open]);

  const save = useCallback(async () => {
    const { name, dateKey, priority } = parsed;
    if (!name || saving) return;

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("quick_tasks").insert({
      user_id: userId,
      name,
      priority: priority ?? 3,
      notes: "",
      date_key: dateKey,
      sort_order: 0,
    });

    if (error) {
      setSaving(false);
      toast("Couldn't save: " + error.message, "error");
      return;
    }

    // Mirror onto the planner, exactly as adding from the Task list does —
    // otherwise "Captured for 2026-08-13" is a lie and that day stays empty.
    if (dateKey) {
      const { error: mirrorErr } = await supabase.from("week_tasks").insert({
        user_id: userId, date_key: dateKey, text: name, done: false, sort_order: 999,
      });
      if (mirrorErr) console.error("[capture:mirror]", mirrorErr.message);
    }
    setSaving(false);

    // Close first so the field is ready for the next thought immediately.
    setOpen(false);
    setValue("");
    window.dispatchEvent(new Event("quick-tasks-changed"));
    toast(dateKey ? `Captured for ${dateKey}` : "Captured", "success");
  }, [parsed, saving, userId, toast]);

  if (!enabled || !open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[18vh] px-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      role="dialog"
      aria-modal="true"
      aria-label="Quick capture"
    >
      <div
        className="w-full max-w-xl rounded-xl border border-border shadow-2xl overflow-hidden"
        style={{ backgroundColor: "var(--surface2)", position: "relative" }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="text-txt3 text-lg select-none" aria-hidden>＋</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
            }}
            placeholder="What's on your mind?"
            aria-label="Task"
            className="flex-1 bg-transparent text-txt text-base placeholder-txt3 outline-none"
          />
          <button
            onClick={save}
            disabled={!parsed.name || saving}
            className="px-3 py-1.5 rounded-lg text-xs bg-violet/20 text-violet2 border border-violet/30 hover:bg-violet/30 disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving…" : "Add"}
          </button>
        </div>

        <div className="px-4 py-2 border-t border-border/60 flex items-center justify-between gap-3 text-[11px]">
          {parsed.matched.length > 0 ? (
            <span className="text-violet2 truncate">
              {parsed.name}
              {parsed.dateKey && <> · <span className="font-mono">{parsed.dateKey}</span></>}
              {parsed.priority && <> · P{parsed.priority}</>}
            </span>
          ) : (
            <span className="text-txt3 truncate">
              Try “tomorrow”, “friday”, “in 3 days”, “20/08”, or “p1”
            </span>
          )}
          <span className="text-txt3 shrink-0">Goes to your Task list</span>
        </div>
      </div>
    </div>
  );
}
