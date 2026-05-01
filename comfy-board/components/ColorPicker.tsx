"use client";

import { useState, useRef, useEffect } from "react";
import { PROJECT_COLORS } from "@/lib/utils";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="w-6 h-6 rounded-full border-2 border-surface3 hover:border-border2 transition-colors"
        style={{ backgroundColor: value }} title="Project color" />
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-surface2 border border-border rounded-lg shadow-xl p-2 grid grid-cols-5 gap-1.5 w-[140px]">
          {PROJECT_COLORS.map((c) => (
            <button key={c} onClick={() => { onChange(c); setOpen(false); }}
              className={`w-5 h-5 rounded-full transition-transform hover:scale-125 ${c === value ? "ring-2 ring-white ring-offset-1 ring-offset-surface2" : ""}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      )}
    </div>
  );
}
