-- KST v0.8 ("Raphael / Great Sage") Durable Work Graph, Spaced Repetition & Contextual Bandits
CREATE TABLE IF NOT EXISTS work_entities (
    entity_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL, -- 'PROJECT' | 'TASK' | 'MEETING' | 'DECISION' | 'NOTE' | 'SKILL_TOPIC' | 'AI_THREAD' | 'TERMINAL_ERROR'
    title TEXT NOT NULL,
    body_summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'BLOCKED' | 'IN_REVIEW' | 'COMPLETED' | 'ARCHIVED'
    priority_score REAL NOT NULL DEFAULT 0.5,
    source_domain TEXT NOT NULL, -- 'calendar' | 'reminders' | 'notes' | 'iterm' | 'gemini_web' | 'chatgpt_app' | 'claude_app' | 'voice' | 'workspace'
    source_uri TEXT NOT NULL DEFAULT '',
    created_ts INTEGER NOT NULL,
    updated_ts INTEGER NOT NULL,
    last_verified_ts INTEGER NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    embedding_f16 BLOB, -- 512-dim float16 / float32 vector (NaturalLanguage NLEmbedding)
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_work_entities_type_status ON work_entities(entity_type, status, updated_ts DESC);
CREATE INDEX IF NOT EXISTS idx_work_entities_source ON work_entities(source_domain, updated_ts DESC);

CREATE TABLE IF NOT EXISTS work_edges (
    edge_id TEXT PRIMARY KEY,
    src_id TEXT NOT NULL,
    dst_id TEXT NOT NULL,
    relation_type TEXT NOT NULL, -- 'BLOCKS' | 'PART_OF' | 'DISCUSSED_IN' | 'REQUIRES_SKILL' | 'CAUSED_BY_ERROR' | 'DERIVED_FROM'
    weight REAL NOT NULL DEFAULT 1.0,
    created_ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_edges_src ON work_edges(src_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_work_edges_dst ON work_edges(dst_id, relation_type);

CREATE TABLE IF NOT EXISTS knowledge_skills (
    skill_id TEXT PRIMARY KEY,
    topic_name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'engineering', -- 'systems' | 'ml_math' | 'swift_macos' | 'distributed_db' | 'debugging' | 'architecture'
    stability_days REAL NOT NULL DEFAULT 1.5, -- FSRS-4.5 S parameter
    difficulty REAL NOT NULL DEFAULT 5.0,     -- FSRS-4.5 D parameter [1, 10]
    retrievability REAL NOT NULL DEFAULT 1.0, -- FSRS-4.5 R(t) in [0, 1]
    linked_project_id TEXT,
    urgency_weight REAL NOT NULL DEFAULT 0.5,
    error_count INTEGER NOT NULL DEFAULT 0,
    practice_count INTEGER NOT NULL DEFAULT 0,
    last_encountered_ts INTEGER NOT NULL,
    last_practiced_ts INTEGER,
    recommended_resource TEXT NOT NULL DEFAULT '',
    micro_challenge TEXT NOT NULL DEFAULT '',
    updated_ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_skills_urgency ON knowledge_skills(urgency_weight DESC, updated_ts DESC);

CREATE TABLE IF NOT EXISTS personal_bandits (
    bandit_id TEXT PRIMARY KEY, -- 'nudge_linucb_v1' | 'music_thompson_v1'
    arm_name TEXT NOT NULL,     -- e.g. 'DELIVER_NOW', 'WAIT_FOR_APP_SWITCH', 'DEFER_30M', 'SILENCE' or '<mode>::<playlist>'
    dimension INTEGER NOT NULL DEFAULT 16,
    state_json TEXT NOT NULL DEFAULT '{}', -- serialized matrix A, vector b, or Beta/Gaussian posterior params
    pulls INTEGER NOT NULL DEFAULT 0,
    cumulative_reward REAL NOT NULL DEFAULT 0.0,
    updated_ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_personal_bandits_arm ON personal_bandits(bandit_id, arm_name);

CREATE TABLE IF NOT EXISTS context_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    ts INTEGER NOT NULL,
    work_mode TEXT NOT NULL, -- 'DEEP_ARCHITECTURE' | 'FAST_EXECUTION' | 'READING_RESEARCH' | 'ADMIN_COMMS' | 'RECOVERY_BREAK'
    interruptibility REAL NOT NULL,
    frontmost_app TEXT NOT NULL DEFAULT '',
    window_title TEXT NOT NULL DEFAULT '',
    git_branch TEXT NOT NULL DEFAULT '',
    music_playlist TEXT NOT NULL DEFAULT '',
    active_entity_id TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_context_snapshots_ts ON context_snapshots(ts DESC);
