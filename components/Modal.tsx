"use client";

import { useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, maxWidth = "max-w-md" }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        className={`border rounded-xl ${maxWidth} w-full max-h-[85vh] overflow-y-auto shadow-2xl`}
        style={{ background: "rgba(26,26,38,0.92)", borderColor: "rgba(124,110,196,0.2)", boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,110,196,0.08) inset" }}
      >
        <div className="flex items-center justify-between p-4 border-b sticky top-0 z-10 rounded-t-xl" style={{ borderColor: "rgba(124,110,196,0.15)", background: "rgba(26,26,38,0.95)" }}>
          <h2 className="font-title text-bright text-lg">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface3 text-txt3 hover:text-txt transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
