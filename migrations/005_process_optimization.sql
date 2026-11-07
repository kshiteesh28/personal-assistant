CREATE TABLE IF NOT EXISTS checklists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  is_template INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id TEXT PRIMARY KEY,
  week_start TEXT NOT NULL,
  what_worked TEXT DEFAULT '',
  what_to_refine TEXT DEFAULT '',
  improvements TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);
