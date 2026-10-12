"use client";

import { CalendarDays, Timer, RefreshCw } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useLocale } from "@/lib/i18n/useLocale";

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
  const { t } = useLocale();
  const label = mode === "task"
    ? isEdit ? t("taskForm.editTask") : t("taskForm.addTask")
    : isEdit ? t("taskForm.editSubtask") : t("taskForm.addSubtask");

  return (
    <Modal open={open} onClose={onClose} title={label}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-txt2 mb-1.5">{t("taskForm.name")}</label>
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSave()}
            className="w-full glass-field px-3 py-2 text-txt text-sm"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm text-txt2 mb-1.5">{t("taskForm.estimatedTime")}</label>
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
                className="w-16 glass-field px-3 py-2 text-txt text-sm"
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
                className="w-16 glass-field px-3 py-2 text-txt text-sm"
              />
              <span className="text-xs text-txt3">min</span>
            </div>
          </div>
        </div>
        <div>
          <label className="text-sm text-txt2 mb-1.5 flex items-center gap-1.5"><CalendarDays size={14} /> {t("taskForm.scheduleOnCalendar")}</label>
          <input
            type="date"
            value={formDate}
            onChange={(e) => setFormDate(e.target.value)}
            className="w-full glass-field px-3 py-2 text-txt text-sm"
          />
          {formDate && <p className="text-[10px] text-violet2 mt-1">{t("taskForm.taskOnCalendar")}</p>}
        </div>
        <div>
          <label className="text-sm text-txt2 mb-1.5 flex items-center gap-1.5"><Timer size={14} /> {t("taskForm.deadlineDueDate")}</label>
          <input
            type="date"
            value={formDeadline}
            onChange={(e) => setFormDeadline(e.target.value)}
            className="w-full glass-field px-3 py-2 text-txt text-sm"
          />
          {formDeadline && <p className="text-[10px] text-danger mt-1">{t("taskForm.deadlineCreated")}</p>}
        </div>
        <div>
          <label className="text-sm text-txt2 mb-1.5 flex items-center gap-1.5"><RefreshCw size={14} /> {t("taskForm.repeat")}</label>
          <select value={formRecurrence || ""} onChange={(e) => setFormRecurrence(e.target.value || null)}
            className="w-full glass-field px-3 py-2 text-txt text-sm">
            <option value="">{t("taskForm.noOneTime")}</option>
            <option value="daily">{t("taskForm.everyDay")}</option>
            <option value="weekly">{t("taskForm.everyWeek")}</option>
            <option value="monthly">{t("taskForm.everyMonth")}</option>
            <option value="yearly">{t("taskForm.everyYear")}</option>
          </select>
          {formRecurrence && (
            <p className="text-[10px] text-violet2 mt-1">
              {formDate
                ? t("taskForm.repeatHint", { date: formDate })
                : t("taskForm.noDateHint")}
              {mode === "task" && <> {t("taskForm.tickHint")}</>}
            </p>
          )}
          {formRecurrence && formDeadline && <p className="text-[10px] text-danger mt-1">{t("taskForm.deadlineRecurHint")}</p>}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3">{t("common.cancel")}</button>
          <button
            onClick={onSave}
            disabled={!formName.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm bg-red-acc hover:bg-red-dark text-white disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
