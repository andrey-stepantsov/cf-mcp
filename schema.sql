DROP TABLE IF EXISTS raw_memories;

CREATE TABLE raw_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'personal',
    content TEXT NOT NULL,
    semantic_markers TEXT,
    retention_weight REAL DEFAULT 1.0,
    importance_score REAL DEFAULT 0.0,
    is_encrypted BOOLEAN DEFAULT 1,
    last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_tree_nodes (
    node_id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    trajectory_status TEXT DEFAULT 'active',
    markers TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quota_ledger (
    tenant_id TEXT PRIMARY KEY,
    api_calls INTEGER DEFAULT 0,
    reset_timestamp DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS search_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    latency_ms REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ingestion_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    latency_ms REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
