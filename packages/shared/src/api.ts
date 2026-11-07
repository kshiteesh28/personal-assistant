import { Event, Task, Reminder, Note, EventCreate, TaskCreate, ReminderCreate, NoteCreate } from "./types";

export interface ChatRequest {
  message: string;
  conversation_id?: string;
  source?: string;
}

export interface ChatActionPerformed {
  command: string;
  status: "success" | "error";
  details?: any;
}

export interface ChatResponse {
  reply: string;
  actions_performed: ChatActionPerformed[];
  engine?: string;
  conversation_id?: string;
}

export interface ExportPayload {
  version: number;
  entities: {
    events: any[];
    tasks: any[];
    reminders: any[];
    notes: any[];
    notes_tasks: any[];
  };
  config: any;
}

export interface ImportRequest {
  payload: ExportPayload;
  mode: "replace" | "merge";
  conflict_resolution?: "ask" | "keep_local" | "keep_export";
  conflict_decisions?: Record<string, "keep_local" | "keep_export">;
}

export interface ImportConflict {
  entity: string;
  id: string;
  local_updated_at: number;
  export_updated_at: number;
}

export interface ImportResult {
  success: boolean;
  conflicts?: ImportConflict[];
  message?: string;
}
