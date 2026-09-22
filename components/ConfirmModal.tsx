"use client";

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
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[299]"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose} />
      <div className="fixed z-[300] w-[90vw] max-w-sm rounded-2xl p-6"
        style={{
          top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          background: "color-mix(in srgb, var(--surface) 95%, transparent)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}>
        {title && <h3 className="text-base font-semibold text-bright mb-2">{title}</h3>}
        <p className="text-sm text-txt2 mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-txt3 hover:text-txt rounded-lg hover:bg-surface3 transition-colors">
            {cancelLabel}
          </button>
          <button onClick={() => { onConfirm(); onClose(); }}
            className={`px-4 py-2 text-sm text-white rounded-lg transition-colors ${
              danger ? "bg-danger hover:opacity-90" : "bg-violet hover:opacity-90"
            }`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
