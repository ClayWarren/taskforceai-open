-- CreateTable
CREATE TABLE developer_api_keys (
    id SERIAL NOT NULL,
    user_id INTEGER NOT NULL,
    key_hash TEXT NOT NULL,
    display_key TEXT NOT NULL,
    name TEXT,
    tier "DeveloperApiTier" NOT NULL DEFAULT 'STARTER',
    rate_limit INTEGER NOT NULL DEFAULT 10,
    monthly_quota INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,
    revoked_at TIMESTAMP(3),
    last_used_at TIMESTAMP(3),

    CONSTRAINT developer_api_keys_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE developer_api_usage (
    id SERIAL NOT NULL,
    api_key_id INTEGER NOT NULL,
    window_start TIMESTAMP(3) NOT NULL,
    window_end TIMESTAMP(3) NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    endpoint TEXT,
    status_code INTEGER,
    response_time INTEGER,
    timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,

    CONSTRAINT developer_api_usage_pkey PRIMARY KEY (id)
);

-- CreateIndex
CREATE UNIQUE INDEX developer_api_keys_key_hash_key ON developer_api_keys (key_hash);

-- CreateIndex
CREATE INDEX developer_api_keys_user_id_idx ON developer_api_keys (user_id);

-- CreateIndex
CREATE INDEX developer_api_keys_tier_idx ON developer_api_keys (tier);

-- CreateIndex
CREATE INDEX developer_api_usage_window_end_idx ON developer_api_usage (window_end);

-- CreateIndex
CREATE UNIQUE INDEX developer_api_usage_api_key_id_window_start_key ON developer_api_usage (
    api_key_id, window_start
);

-- AddForeignKey
ALTER TABLE developer_api_keys ADD CONSTRAINT developer_api_keys_user_id_fkey FOREIGN KEY (
    user_id
) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE developer_api_usage ADD CONSTRAINT developer_api_usage_api_key_id_fkey FOREIGN KEY (
    api_key_id
) REFERENCES developer_api_keys (id) ON DELETE CASCADE ON UPDATE CASCADE;
