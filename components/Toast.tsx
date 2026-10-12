"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextType {
  toast: (message: string, type?: "success" | "error" | "info") => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    if (type !== "error") {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    }
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] space-y-2"
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div key={t.id}
            role={t.type === "error" ? "alert" : undefined}
            className={cn(
              "px-4 py-2.5 rounded-lg text-sm shadow-xl border animate-fade-in max-w-xs cursor-pointer",
              t.type === "success" && "bg-green-acc/15 border-green-acc/30 text-green-text",
              t.type === "error" && "bg-red-500/15 border-red-500/30 text-red-text",
              t.type === "info" && "bg-violet/15 border-violet/30 text-violet2-text",
            )}
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          >
            <span className="mr-2" aria-hidden="true">
              {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
