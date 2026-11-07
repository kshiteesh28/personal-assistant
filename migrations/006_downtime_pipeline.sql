CREATE TABLE IF NOT EXISTS downtime_pipeline (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'research',
  estimated_mins INTEGER DEFAULT 30,
  priority INTEGER DEFAULT 2,
  status TEXT DEFAULT 'queued',
  created_at INTEGER NOT NULL
);
