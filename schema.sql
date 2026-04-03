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

-- Phase 5.1: The Semantic Graph Memory (Index & Relations)

-- The Persistent Semantic Node (The "What" and "Why")
CREATE TABLE IF NOT EXISTS markers (
    marker_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    temporal_ledger_id TEXT NOT NULL, -- FK to events table
    pragmatic_type TEXT NOT NULL,
    synthesized_content TEXT NOT NULL,
    validity_weight REAL DEFAULT 1.0,
    has_vector_index BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- The Persistent Semantic Edge (The Knowledge Graph)
CREATE TABLE IF NOT EXISTS marker_edges (
    edge_id TEXT PRIMARY KEY,
    source_marker_id TEXT NOT NULL, -- FK to markers
    target_entity_id TEXT NOT NULL, -- e.g., an artefact_id or another marker_id
    relationship_type TEXT NOT NULL, -- e.g., 'AFFECTS_ARTEFACT', 'CAUSED_BY'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
