CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,
  location TEXT,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS events_start_ts_idx ON events(start_ts);
CREATE INDEX IF NOT EXISTS events_end_ts_idx ON events(end_ts);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  due_ts INTEGER,
  priority INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'todo',
  project TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_due_ts_idx ON tasks(due_ts);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_priority_idx ON tasks(priority);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  trigger_ts INTEGER NOT NULL,
  repeat_rule TEXT,
  linked_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  snooze_until_ts INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS reminders_trigger_ts_idx ON reminders(trigger_ts);
CREATE INDEX IF NOT EXISTS reminders_status_idx ON reminders(status);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  linked_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS notes_linked_event_id_idx ON notes(linked_event_id);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED, title, body);

CREATE TABLE IF NOT EXISTS notes_tasks (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, task_id)
);

CREATE TABLE IF NOT EXISTS user_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(source, cache_key)
);

CREATE INDEX IF NOT EXISTS integration_cache_source_key_idx ON integration_cache(source, cache_key);
CREATE INDEX IF NOT EXISTS integration_cache_expires_at_idx ON integration_cache(expires_at);

CREATE TABLE IF NOT EXISTS integration_snapshot (
  source TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  match_rules TEXT NOT NULL,
  is_predefined INTEGER NOT NULL DEFAULT 0,
  is_discovered INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO activity_categories (name, match_rules, is_predefined) VALUES 
('team_call', '[{"field":"window_title","pattern":"Zoom|Teams"}]', 1),
('cursor_coding', '[{"field":"app_name","pattern":"Cursor"}]', 1),
('mail', '[{"field":"app_name","pattern":"Outlook|Mail"}]', 1),
('jira', '[{"field":"window_title","pattern":"Jira"}]', 1);

CREATE TABLE IF NOT EXISTS activity_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_type TEXT NOT NULL,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'active_window',
  app_name TEXT,
  window_title TEXT,
  process_name TEXT
);

CREATE INDEX IF NOT EXISTS activity_sessions_start_ts_idx ON activity_sessions(start_ts);
CREATE INDEX IF NOT EXISTS activity_sessions_activity_type_idx ON activity_sessions(activity_type);
