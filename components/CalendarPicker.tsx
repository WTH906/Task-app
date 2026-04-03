"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { DAY_NAMES } from "@/lib/utils";

interface CalendarPickerProps {
  value: string | null;
  onChange: (date: string | null) => void;
  className?: string;
}

export function CalendarPicker({ value, onChange, className = "" }: CalendarPickerProps) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    if (value) return new Date(value + "T00:00:00");
    return new Date();
  });
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popupW = 264;
    const popupH = 320;
    let top = rect.bottom + 4;
    let left = rect.left;
    if (left + popupW > window.innerWidth) left = window.innerWidth - popupW - 8;
    if (left < 8) left = 8;
    if (top + popupH > window.innerHeight) top = rect.top - popupH - 4;
    setPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const handleClickOutside = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || popupRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const handleScroll = () => updatePos();
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", updatePos);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (value) setViewDate(new Date(value + "T00:00:00"));
  }, [value]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split("T")[0];

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const makeDate = (d: number) => {
    const m = String(month + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${year}-${m}-${dd}`;
  };

  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];

  const popup = open && mounted
    ? createPortal(
        <div
          ref={popupRef}
          className="fixed z-[9999] bg-surface2 border border-border rounded-lg shadow-2xl p-3 w-[264px]"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setViewDate(new Date(year, month - 1, 1))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface3 text-txt2">‹</button>
            <span className="text-sm font-medium text-bright">{monthNames[month]} {year}</span>
            <button onClick={() => setViewDate(new Date(year, month + 1, 1))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface3 text-txt2">›</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DAY_NAMES.map((d) => (<div key={d} className="text-center text-[10px] text-txt3 py-1">{d}</div>))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d, i) => {
              if (d === null) return <div key={i} />;
              const dateStr = makeDate(d);
              const isSelected = dateStr === value;
              const isToday = dateStr === today;
              return (
                <button key={i} onClick={() => { onChange(dateStr); setOpen(false); }}
                  className={`w-8 h-8 text-xs rounded flex items-center justify-center transition-colors ${
                    isSelected ? "bg-violet text-white font-bold"
                    : isToday ? "bg-violet/20 text-violet2"
                    : "text-txt2 hover:bg-surface3"
                  }`}>{d}</button>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 pt-2 border-t border-border">
            <button onClick={() => { onChange(null); setOpen(false); }} className="text-xs text-txt3 hover:text-danger transition-colors">Clear</button>
            <button onClick={() => { onChange(today); setOpen(false); }} className="text-xs text-txt3 hover:text-violet2 transition-colors">Today</button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`inline-block ${className}`}>
      <button ref={btnRef} type="button" onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface3 hover:bg-border text-txt2 hover:text-txt transition-colors">
        <span>📅</span>
        <span>{value || "No date"}</span>
      </button>
      {popup}
    </div>
  );
}
