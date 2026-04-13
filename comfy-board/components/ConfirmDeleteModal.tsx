"use client";

import { useState, useEffect, useRef } from "react";

interface ConfirmDeleteModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  confirmText: string;
  description?: string;
  loading?: boolean;
}

export function ConfirmDeleteModal({
  open,
  onClose,
  onConfirm,
  title,
  confirmText,
  description,
  loading = false,
}: ConfirmDeleteModalProps) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const canConfirm = typed === confirmText;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="bg-surface2 border border-danger/30 rounded-xl max-w-sm w-full shadow-2xl">
        <div className="p-5">
          <h2 className="text-lg font-title text-danger mb-2">{title}</h2>
          {description && (
            <p className="text-sm text-txt2 mb-4">{description}</p>
          )}
          <p className="text-sm text-txt2 mb-2">
            Type <span className="font-mono text-danger bg-danger/10 px-1.5 py-0.5 rounded">{confirmText}</span> to confirm:
          </p>
          <input
            ref={inputRef}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canConfirm && !loading) onConfirm();
            }}
            className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm font-mono placeholder-txt3"
            placeholder={confirmText}
            disabled={loading}
          />
        </div>
        <div className="flex justify-end gap-2 p-4 pt-0">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm || loading}
            className="px-4 py-2 rounded-lg text-sm bg-danger/20 border border-danger/40 text-danger hover:bg-danger/30 transition-colors disabled:opacity-30"
          >
            {loading ? "Deleting..." : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
