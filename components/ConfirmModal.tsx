"use client";

import { useCallback, useEffect, useRef } from "react";

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel",
  danger = false, onConfirm, onClose,
}: ConfirmModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  const trapFocus = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>("button");
      first?.focus();
    }
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, [open, trapFocus]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[299]"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose} />
      <div ref={panelRef} className="fixed z-[300] w-[90vw] max-w-sm rounded-2xl p-6"
        role="alertdialog" aria-modal="true"
        aria-labelledby={title ? "confirm-title" : undefined}
        aria-describedby="confirm-message"
        style={{
          top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          background: "color-mix(in srgb, var(--surface) 95%, transparent)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}>
        {title && <h2 id="confirm-title" className="text-base font-semibold text-bright mb-2">{title}</h2>}
        <p id="confirm-message" className="text-sm text-txt2 mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-txt3 hover:text-txt rounded-lg hover:bg-surface3 transition-colors">
            {cancelLabel}
          </button>
          <button onClick={() => { onConfirm(); onClose(); }}
            className={`px-4 py-2 text-sm text-on-accent rounded-lg transition-colors ${
              danger ? "bg-danger hover:opacity-90" : "bg-violet hover:opacity-90"
            }`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
