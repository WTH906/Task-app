"use client";

import { useEffect, useRef, useCallback } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, maxWidth = "max-w-md" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const titleId = `modal-title-${title.replace(/\s+/g, "-").toLowerCase()}`;

  const trapFocus = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    document.addEventListener("keydown", trapFocus);

    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(
        'input, select, textarea, button:not([aria-label="Close"])'
      );
      if (first) first.focus();
      else panel.focus();
    });

    return () => {
      document.removeEventListener("keydown", trapFocus);
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, [open, trapFocus]);

  if (!open) return null;

  return (
    <div
      className="glass-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={panelRef} className={`glass-panel ${maxWidth} w-full`} tabIndex={-1}>
        <div className="glass-header flex items-center justify-between p-4 sticky top-0 z-10">
          <h2 id={titleId} className="font-title text-bright text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-txt3 hover:text-txt transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="p-4 relative z-[1]">{children}</div>
      </div>
    </div>
  );
}
