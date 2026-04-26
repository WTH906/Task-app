"use client";

import { CalendarDays, Timer, RefreshCw } from "lucide-react";
import { Modal } from "@/components/Modal";

interface TaskFormModalProps {
  open: boolean;
  onClose: () => void;
  mode: "task" | "subtask";
  isEdit: boolean;
  formName: string;
  setFormName: (v: string) => void;
  formEst: number;
  setFormEst: (v: number) => void;
  formDate: string;
  setFormDate: (v: string) => void;
  formDeadline: string;
  setFormDeadline: (v: string) => void;
  formRecurrence: string | null;
  setFormRecurrence: (v: string | null) => void;
  saving: boolean;
  onSave: () => void;
}

export function TaskFormModal({
  open, onClose, mode, isEdit,
  formName, setFormName, formEst, setFormEst,
  formDate, setFormDate, formDeadline, setFormDeadline,
  formRecurrence, setFormRecurrence,
  saving, onSave,
}: TaskFormModalProps) {
  const label = mode === "task"
    ? isEdit ? "Edit Task" : "Add Task"
    : isEdit ? "Edit Subtask" : "Add Subtask";

  return (
    <Modal open={open} onClose={onClose} title={label}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-txt2 mb-1.5">Name</label>
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSave()}
            className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm text-txt2 mb-1.5">Estimated time</label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={Math.floor(formEst / 60) || ""}
                onChange={(e) => {
                  const h = parseInt(e.target.value) || 0;
                  setFormEst(Math.max(0, h * 60 + (formEst % 60)));
                }}
                onFocus={(e) => { if (e.target.value === "0") e.target.value = ""; e.target.select(); }}
                min={0}
                placeholder="0"
                className="w-16 bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
              />
              <span className="text-xs text-txt3">h</span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={formEst % 60 || ""}
                onChange={(e) => {
                  const m = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                  setFormEst(Math.floor(formEst / 60) * 60 + m);
                }}
                onFocus={(e) => { if (e.target.value === "0") e.target.value = ""; e.target.select(); }}
                min={0}
                max={59}
                placeholder="0"
                className="w-16 bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
              />
              <span className="text-xs text-txt3">min</span>
            </div>
          </div>
        </div>
        <div>
          <label className="text-sm text-txt2 mb-1.5 flex items-center gap-1.5"><CalendarDays size={14} /> Schedule on calendar</label>
          <input
            type="date"
            value={formDate}
            onChange={(e) => setFormDate(e.target.value)}
            className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
          />
          {formDate && <p className="text-[10px] text-violet2 mt-1">Task will appear on the calendar for this date</p>}
        </div>
        <div>
          <label className="text-sm text-txt2 mb-1.5 flex items-center gap-1.5"><Timer size={14} /> Deadline (due date)</label>
          <input
            type="date"
            value={formDeadline}
            onChange={(e) => setFormDeadline(e.target.value)}
            className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
          />
          {formDeadline && <p className="text-[10px] text-danger mt-1">A countdown deadline will be created</p>}
        </div>
        {formDeadline && (
          <div>
            <label className="text-sm text-txt2 mb-1.5 flex items-center gap-1.5"><RefreshCw size={14} /> Recurring?</label>
            <select value={formRecurrence || ""} onChange={(e) => setFormRecurrence(e.target.value || null)}
              className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm">
              <option value="">No — one-time deadline</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3">Cancel</button>
          <button
            onClick={onSave}
            disabled={!formName.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm bg-red-acc hover:bg-red-dark text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
