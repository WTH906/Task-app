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

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (type !== "number") {
        inputRef.current.select();
      }
    }
  }, [editing, type]);

  const save = useCallback(
    (val: string) => {
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
      debounceRef.current = setTimeout(() => onSave(val), 300);
    }
  };

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
        onBlur={() => { save(draft); }}
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
