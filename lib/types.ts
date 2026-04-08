export interface RoutineTask {
  id: string; user_id: string; text: string;
  est_minutes: number; sort_order: number;
  created_at: string; checked?: boolean;
}

export interface Project {
  id: string; user_id: string; title: string;
  description: string; elapsed_seconds: number;
  active_task_id: string | null; alarm_fired: boolean;
  sort_order: number; created_at: string;
  color: string;
  deadline: string | null;
}

export interface ProjectTask {
  id: string; project_id: string; user_id: string;
  name: string; est_minutes: number; deadline: string | null;
  progress: number; notes: string; elapsed_seconds: number;
  sort_order: number; created_at: string; subtasks?: Subtask[];
  file_url: string | null; file_name: string | null;
}

export interface Subtask {
  id: string; task_id: string; user_id: string;
  name: string; est_minutes: number; deadline: string | null;
  progress: number; notes: string; sort_order: number;
  created_at: string; elapsed_seconds: number;
  file_url: string | null; file_name: string | null;
}

export interface Template {
  id: string; user_id: string; name: string;
  task_data: Partial<ProjectTask>[]; created_at: string;
}

export interface WeekTask {
  id: string; user_id: string; date_key: string;
  text: string; done: boolean; project_id: string | null;
  project_task_id: string | null; sort_order: number;
  created_at: string;
}

export interface WeekDay {
  id: string; user_id: string; date_key: string;
  title: string; notes: string;
}

export interface WeekTemplate {
  id: string; user_id: string; weekday: number; title: string;
}

export interface Deadline {
  id: string; user_id: string; label: string;
  target_datetime: string; created_at: string;
  recurrence: string | null;
}

export interface ActivityLog {
  id: string; user_id: string; project_id: string | null;
  action: string; detail: string; created_at: string;
}

export interface WeeklyRoutineTask {
  id: string; user_id: string; text: string;
  est_minutes: number; sort_order: number; created_at: string;
  checked?: boolean;
}

export interface QuickTask {
  id: string; user_id: string; name: string;
  priority: number; notes: string;
  sort_order: number; created_at: string;
}
