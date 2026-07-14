CREATE TABLE sync_push_results (
    user_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
    CONSTRAINT sync_push_results_pkey PRIMARY KEY (user_id, idempotency_key)
);

CREATE INDEX sync_push_results_expires_at_idx ON sync_push_results (expires_at);
