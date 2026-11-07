export type EnergyLevel = "high" | "medium" | "low";

export type TaskType = 
  | "deep_work" 
  | "communication" 
  | "admin" 
  | "creative" 
  | "review" 
  | "meeting_prep" 
  | "personal" 
  | "fitness" 
  | "mental_health";

export type TimePreference = "morning" | "evening" | "either";

export interface Event {
  id: string;
  title: string;
  start_ts: number;
  end_ts: number;
  all_day: boolean;
  recurrence_rule?: string | null;
  location?: string | null;
  description?: string | null;
  created_at: number;
  updated_at: number;
}

export interface Task {
  id: string;
  title: string;
  due_ts?: number | null;
  priority: 1 | 2 | 3;
  status: "todo" | "in_progress" | "done" | "cancelled";
  project?: string | null;
  tags?: string | null;
  created_at: number;
  updated_at: number;
  position: number;
  time_estimate: number;
  energy_level: EnergyLevel;
  task_type: TaskType;
  is_splittable: boolean;
  context?: string | null;
  time_preference: TimePreference;
  pinned_time?: number | null;
  progress: number;
}

export interface Reminder {
  id: string;
  title: string;
  trigger_ts: number;
  repeat_rule?: "daily" | "weekly" | null;
  linked_event_id?: string | null;
  status: "active" | "snoozed" | "dismissed";
  snooze_until_ts?: number | null;
  created_at: number;
  updated_at: number;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  linked_event_id?: string | null;
  created_at: number;
  updated_at: number;
}

export interface ScheduleBlock {
  type: "task" | "meeting" | "buffer" | "lunch" | "dinner" | "break" | "flex";
  start_ts: number;
  end_ts: number;
  title: string;
  task_id?: string;
  event_id?: string;
  energy_band?: EnergyLevel;
}

export interface OverflowSuggestion {
  task_id: string;
  action: "trim" | "defer" | "delegate" | "remove";
  suggested_estimate?: number;
  defer_to?: string;
  freed_minutes?: number;
}

export interface DailySchedule {
  id: string;
  date: string; // YYYY-MM-DD
  blocks: ScheduleBlock[];
  overflow: OverflowSuggestion[];
  created_at: number;
  updated_at: number;
}

export interface BriefSectionContent {
  title: string;
  body: string;
}

export interface BriefSection {
  id: string;
  title: string;
  content: BriefSectionContent[];
}

export interface Brief {
  date: string;
  events: Event[];
  tasks: Task[];
  reminders: Reminder[];
  overdue_tasks: Task[];
  schedule: {
    blocks: ScheduleBlock[];
    overflow: OverflowSuggestion[];
  };
  sections: BriefSection[];
  integrations: any[]; 
  usage_summary: any;
  generated_at: number;
}

export interface IntegrationStatus {
  source: string;
  enabled: boolean;
  status: "ok" | "error" | "auth_required";
  message?: string;
}

export interface HealthStatus {
  status: string;
  db: string;
  version: string;
}

export interface IntegrationPlugin {
  id: string;
  name: string;
}

export interface EventCreate extends Partial<Omit<Event, 'id' | 'created_at' | 'updated_at'>> {
  title: string;
  start_ts: number;
  end_ts: number;
}

export interface TaskCreate extends Partial<Omit<Task, 'id' | 'created_at' | 'updated_at'>> {
  title: string;
}

export interface NoteCreate extends Partial<Omit<Note, 'id' | 'created_at' | 'updated_at'>> {
  title: string;
  body: string;
}

export interface ReminderCreate extends Partial<Omit<Reminder, 'id' | 'created_at' | 'updated_at'>> {
  title: string;
  trigger_ts: number;
}
