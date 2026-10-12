"use client";

import { useState, useRef, useEffect } from "react";
import { PROJECT_COLORS } from "@/lib/utils";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(value);
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
        <div className="absolute top-full mt-1 left-0 z-50 bg-surface2 border border-border rounded-lg shadow-xl p-2 w-[140px]">
          <div className="grid grid-cols-5 gap-1.5">
            {PROJECT_COLORS.map((c) => (
              <button key={c} onClick={() => { onChange(c); setHexInput(c); setOpen(false); }}
                className={`w-5 h-5 rounded-full transition-transform hover:scale-125 ${c === value ? "ring-2 ring-white ring-offset-1 ring-offset-surface2" : ""}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/50">
            <div className="w-4 h-4 rounded-full shrink-0 border border-border/50" style={{ backgroundColor: HEX_RE.test(hexInput) ? hexInput : value }} />
            <input
              type="text"
              value={hexInput}
              onChange={(e) => {
                let v = e.target.value;
                if (v && !v.startsWith("#")) v = "#" + v;
                setHexInput(v);
                if (HEX_RE.test(v)) onChange(v);
              }}
              onFocus={() => setHexInput(value)}
              placeholder="#000000"
              maxLength={7}
              className="w-full bg-surface text-txt text-xs font-mono px-1.5 py-1 rounded border border-border/50 focus:border-violet2 outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
