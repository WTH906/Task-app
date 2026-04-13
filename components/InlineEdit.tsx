"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  placeholder?: string;
  type?: "text" | "number" | "textarea";
  min?: number;
  max?: number;
}

export function InlineEdit({
  value,
  onSave,
  className = "",
  placeholder = "Click to edit",
  type = "text",
  min,
  max,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();
  const editingRef = useRef(false);

  // Only sync value → draft when NOT editing (prevents mid-type resets)
  useEffect(() => {
    if (!editingRef.current) {
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    editingRef.current = editing;
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (type !== "number") {
        inputRef.current.select();
      }
    }
  }, [editing, type]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const save = useCallback(
    (val: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = val.trim();
      if (type === "number") {
        const num = parseInt(trimmed) || 0;
        onSave(String(Math.max(min ?? 0, Math.min(max ?? 9999, num))));
      } else {
        onSave(trimmed || value);
      }
      setEditing(false);
    },
    [onSave, value, type, min, max]
  );

  const handleChange = (val: string) => {
    setDraft(val);
    if (type === "textarea") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSave(val);
      }, 800);
    }
  };

  // Track whether save already fired to prevent blur double-save
  const savedRef = useRef(false);

  const wrappedSave = useCallback(
    (val: string) => {
      if (savedRef.current) return;
      savedRef.current = true;
      save(val);
      // Reset after a tick so next edit cycle works
      setTimeout(() => { savedRef.current = false; }, 50);
    },
    [save]
  );

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        className={`cursor-pointer hover:bg-surface3 rounded px-1 -mx-1 transition-colors ${
          !value ? "text-txt3 italic" : ""
        } ${className}`}
        title="Click to edit"
      >
        {value || placeholder}
      </span>
    );
  }

  if (type === "textarea") {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => wrappedSave(draft)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className={`bg-surface3 border border-border rounded px-2 py-1 text-txt w-full resize-none ${className}`}
        rows={2}
        placeholder={placeholder}
      />
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => save(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") save(draft);
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
      className={`bg-surface3 border border-border rounded px-2 py-1 text-txt ${className}`}
      placeholder={placeholder}
      min={min}
      max={max}
    />
  );
}
