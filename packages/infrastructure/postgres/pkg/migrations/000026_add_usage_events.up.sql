CREATE TABLE usage_events (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    task_id TEXT,
    conversation_id INTEGER,
    user_id TEXT,
    organization_id INTEGER,
    plan TEXT,
    source TEXT NOT NULL,
    modality TEXT NOT NULL,
    operation TEXT NOT NULL,
    model TEXT,
    quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    unit TEXT NOT NULL,
    cost_micros BIGINT NOT NULL DEFAULT 0,
    metadata JSONB
);

CREATE INDEX usage_events_user_created_at_idx ON usage_events (user_id, created_at DESC);
CREATE INDEX usage_events_org_created_at_idx ON usage_events (organization_id, created_at DESC);
CREATE INDEX usage_events_task_id_idx ON usage_events (task_id);
