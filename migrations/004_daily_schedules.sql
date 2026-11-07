CREATE TABLE IF NOT EXISTS daily_schedules (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  blocks TEXT NOT NULL,
  overflow TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
