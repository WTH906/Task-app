"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { Deadline } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/Modal";

export default function DeadlinesPage() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [userId, setUserId] = useState("");
  const [now, setNow] = useState(new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [formLabel, setFormLabel] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("23:59");
  const [formRecurrence, setFormRecurrence] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    const { data } = await supabase.from("deadlines").select("*").eq("user_id", user.id).order("target_datetime");
    setDeadlines(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Auto-renew recurring deadlines that have passed
  useEffect(() => {
    const renewRecurring = async () => {
      const supabase = createClient();
      for (const d of deadlines) {
        if (!d.recurrence) continue;
        const target = new Date(d.target_datetime);
        if (target.getTime() > now.getTime()) continue;

        let next = new Date(target);
        while (next.getTime() <= now.getTime()) {
          switch (d.recurrence) {
            case "daily": next.setDate(next.getDate() + 1); break;
            case "weekly": next.setDate(next.getDate() + 7); break;
            case "monthly": next.setMonth(next.getMonth() + 1); break;
            case "yearly": next.setFullYear(next.getFullYear() + 1); break;
          }
        }

        await supabase.from("deadlines")
          .update({ target_datetime: next.toISOString() })
          .eq("id", d.id);
      }
      load();
    };

    const hasExpiredRecurring = deadlines.some(
      (d) => d.recurrence && new Date(d.target_datetime).getTime() <= now.getTime()
    );
    if (hasExpiredRecurring) renewRecurring();
  }, [deadlines, now, load]);

  const addDeadline = async () => {
    if (!formLabel.trim() || !formDate) return;
    const supabase = createClient();
    await supabase.from("deadlines").insert({
      user_id: userId,
      label: formLabel.trim(),
      target_datetime: `${formDate}T${formTime}:00`,
      recurrence: formRecurrence,
    });
    setModalOpen(false);
    setFormLabel(""); setFormDate(""); setFormTime("23:59"); setFormRecurrence(null);
    load();
  };

  const removeDeadline = async (id: string) => {
    const supabase = createClient();
    await supabase.from("deadlines").delete().eq("id", id);
    load();
  };

  const getCountdown = (target: string) => {
    const diff = new Date(target).getTime() - now.getTime();
    if (diff <= 0) return { text: "Passed", passed: true };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    let text = "";
    if (days > 0) text = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    else if (hours > 0) text = `${hours}h ${minutes}m ${seconds}s`;
    else text = `${minutes}m ${seconds}s`;
    return { text, passed: false };
  };

  const getColor = (target: string) => {
    const diff = new Date(target).getTime() - now.getTime();
    if (diff <= 0) return "#5c5a7a";
    if (diff < 24 * 60 * 60 * 1000) return "#f43f5e";
    if (diff < 3 * 24 * 60 * 60 * 1000) return "#f59e0b";
    return "#4caf50";
  };

  const recurrenceLabels: Record<string, string> = {
    daily: "🔄 Daily", weekly: "🔄 Weekly", monthly: "🔄 Monthly", yearly: "🔄 Yearly",
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-title text-2xl text-bright">Deadlines</h1>
          <p className="text-sm text-txt2 mt-0.5">{deadlines.length} countdowns</p>
        </div>
        <button onClick={() => setModalOpen(true)}
          className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white transition-colors">
          ＋ Add Deadline
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {deadlines.map((d) => {
          const countdown = getCountdown(d.target_datetime);
          const color = getColor(d.target_datetime);
          const targetDate = new Date(d.target_datetime);

          return (
            <div key={d.id} className={cn(
              "bg-surface border rounded-xl p-4 transition-all",
              countdown.passed ? "border-border opacity-60" : "border-border hover:border-border2"
            )}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-bright font-medium text-sm">{d.label}</h3>
                  {d.recurrence && (
                    <span className="text-[10px] text-violet2 bg-violet/10 px-1.5 py-0.5 rounded mt-1 inline-block">
                      {recurrenceLabels[d.recurrence] || d.recurrence}
                    </span>
                  )}
                </div>
                <button onClick={() => removeDeadline(d.id)}
                  className="text-txt3 hover:text-danger text-sm transition-colors">✕</button>
              </div>

              <p className="text-xs text-txt3 mb-2">
                {targetDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}{" "}
                {targetDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </p>

              <p className="font-mono text-lg mb-3" style={{ color }}>{countdown.text}</p>

              <div className="w-full h-1.5 bg-surface3 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{
                  backgroundColor: color,
                  width: countdown.passed ? "100%" :
                    `${Math.max(0, Math.min(100, ((now.getTime() - new Date(d.created_at).getTime()) / (targetDate.getTime() - new Date(d.created_at).getTime())) * 100))}%`,
                }} />
              </div>
            </div>
          );
        })}
      </div>

      {deadlines.length === 0 && (
        <div className="text-center py-16 text-txt3">
          <p className="text-lg mb-2">No deadlines set</p>
          <p className="text-sm mb-4">Add a countdown to track important dates</p>
          <button onClick={() => setModalOpen(true)}
            className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white transition-colors">
            Add Deadline
          </button>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Deadline">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Label</label>
            <input type="text" value={formLabel} onChange={(e) => setFormLabel(e.target.value)}
              className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm"
              placeholder="e.g. Project deadline" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-txt2 mb-1.5">Date</label>
              <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
                className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm" />
            </div>
            <div>
              <label className="block text-sm text-txt2 mb-1.5">Time</label>
              <input type="time" value={formTime} onChange={(e) => setFormTime(e.target.value)}
                className="w-full bg-surface3 border border-border rounded-lg px-3 py-2 text-txt text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-txt2 mb-1.5">Repeat</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: null, label: "None" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
                { value: "yearly", label: "Yearly" },
              ].map((opt) => (
                <button key={opt.label} onClick={() => setFormRecurrence(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    formRecurrence === opt.value
                      ? "bg-violet/15 border-violet/30 text-violet2"
                      : "bg-surface border-border text-txt3 hover:text-txt"
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg text-sm text-txt2 hover:bg-surface3">Cancel</button>
            <button onClick={addDeadline} disabled={!formLabel.trim() || !formDate}
              className="px-4 py-2 rounded-lg text-sm bg-violet hover:bg-violet-dim text-white disabled:opacity-50">Add</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
