-- Add trust_layer_enabled to users
ALTER TABLE users ADD COLUMN trust_layer_enabled BOOLEAN NOT NULL DEFAULT false;

-- CreateTable execution_traces
CREATE TABLE execution_traces (
    id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    user_id INTEGER,
    goal TEXT NOT NULL,
    plan JSONB,
    steps JSONB,
    self_eval JSONB,
    report JSONB,
    artifacts JSONB,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT execution_traces_pkey PRIMARY KEY (id)
);

-- CreateIndex
CREATE UNIQUE INDEX execution_traces_task_id_key ON execution_traces (task_id);
CREATE INDEX execution_traces_user_id_idx ON execution_traces (user_id);
CREATE INDEX execution_traces_task_id_idx ON execution_traces (task_id);
