-- Destroy legacy Phase 5 Vector Memory Architecture
DROP TABLE IF EXISTS memories;
DROP TABLE IF EXISTS search_telemetry;
DROP TABLE IF EXISTS ingestion_telemetry;
DROP TABLE IF EXISTS skill_tree_nodes;

-- Establish the canonical Event Ledger (Artefact Management)
CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    actor TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL, -- JSON string
    previous_event_id TEXT,
    sync_status TEXT DEFAULT 'synced',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Optimize for timeline reconstruction via Materializer.ts
CREATE INDEX IF NOT EXISTS idx_events_session_timestamp ON events(session_id, timestamp);

-- Preserve tenant quota tracking
CREATE TABLE IF NOT EXISTS quota_ledger (
    tenant_id TEXT PRIMARY KEY,
    api_calls INTEGER DEFAULT 0,
    reset_timestamp DATETIME NOT NULL
);
