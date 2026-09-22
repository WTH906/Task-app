"use client";

import { progressColor } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  height?: number;
  showLabel?: boolean;
  label?: string;
}

export function ProgressBar({ value, height = 8, showLabel = false, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = progressColor(clamped);

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex items-center justify-between mb-1">
          {label && <span className="text-xs text-txt2">{label}</span>}
          <span className="text-xs font-mono" style={{ color }}>
            {Math.round(clamped)}%
          </span>
        </div>
      )}
      <div
        className="w-full bg-surface3 rounded-full overflow-hidden"
        style={{ height }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
