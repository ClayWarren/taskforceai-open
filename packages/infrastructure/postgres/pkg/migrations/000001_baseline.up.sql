-- CreateSchema
CREATE SCHEMA IF NOT EXISTS public;

-- CreateEnum
CREATE TYPE SUBSCRIPTIONSOURCE AS ENUM ('STRIPE', 'APP_STORE', 'PLAY_STORE');

-- CreateEnum
CREATE TYPE DEVELOPERAPITIER AS ENUM ('STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE DEVICE_LOGINSSTATUS AS ENUM ('PENDING', 'AUTHORIZED', 'COMPLETED', 'EXPIRED');

-- CreateTable
CREATE TABLE users (
    id SERIAL NOT NULL,
    username TEXT NOT NULL,
    email TEXT,
    full_name TEXT,
    hashed_password TEXT NOT NULL,
    disabled BOOLEAN NOT NULL DEFAULT false,
    theme_preference TEXT NOT NULL DEFAULT 'dark',
    plan TEXT NOT NULL DEFAULT 'free',
    message_count INTEGER NOT NULL DEFAULT 0,
    last_message_timestamp TIMESTAMP(3),
    is_admin BOOLEAN NOT NULL DEFAULT false,
    subscription_id TEXT,
    subscription_status TEXT,
    subscription_source SUBSCRIPTIONSOURCE,
    price_id TEXT,
    payment_method_brand TEXT,
    payment_method_last4 TEXT,
    current_period_start TIMESTAMP(3),
    current_period_end TIMESTAMP(3),
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    stripe_subscription_event_created_at TIMESTAMP(3),
    customer_id TEXT,
    revenuecat_app_user_id TEXT,
    mobile_original_transaction_id TEXT,
    mobile_product_id TEXT,
    api_subscription_id TEXT,
    api_subscription_status TEXT,
    api_tier DEVELOPERAPITIER NOT NULL DEFAULT 'STARTER',
    api_requests_used INTEGER NOT NULL DEFAULT 0,
    api_requests_limit INTEGER NOT NULL DEFAULT 100,
    api_current_period_start TIMESTAMP(3),
    api_current_period_end TIMESTAMP(3),
    requests_limit INTEGER,
    reset_date TIMESTAMP(3),
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    mfa_totp_secret TEXT,
    mfa_verified_at TIMESTAMP(3),

    CONSTRAINT users_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE accounts (
    id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    provideraccountid TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at INTEGER,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    session_state TEXT,

    CONSTRAINT accounts_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE sessions (
    id TEXT NOT NULL,
    sessiontoken TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    expires TIMESTAMP(3) NOT NULL,

    CONSTRAINT sessions_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE verification_tokens (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL,
    expires TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE conversations (
    id SERIAL NOT NULL,
    timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT,
    user_input TEXT NOT NULL,
    result TEXT,
    execution_time DOUBLE PRECISION,
    model TEXT,
    agent_count INTEGER NOT NULL DEFAULT 4,
    sync_version INTEGER NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    device_id TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT conversations_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE messages (
    id SERIAL NOT NULL,
    message_id TEXT NOT NULL,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    is_streaming BOOLEAN NOT NULL DEFAULT false,
    is_agent_status BOOLEAN NOT NULL DEFAULT false,
    elapsed_seconds DOUBLE PRECISION,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    error TEXT,
    sources JSONB,
    tool_events JSONB,
    agent_statuses JSONB,
    sync_version INTEGER NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    device_id TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT messages_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE metrics (
    id SERIAL NOT NULL,
    timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metric_name TEXT NOT NULL,
    metric_value DOUBLE PRECISION,
    details TEXT,

    CONSTRAINT metrics_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE downloads (
    id SERIAL NOT NULL,
    timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    product TEXT NOT NULL,
    platform TEXT NOT NULL,
    version TEXT NOT NULL,
    user_agent TEXT,
    ip_address_hash TEXT,
    country TEXT,
    referrer TEXT,

    CONSTRAINT downloads_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE push_notification_tokens (
    id SERIAL NOT NULL,
    token TEXT NOT NULL,
    platform TEXT NOT NULL,
    device_id TEXT,
    app_version TEXT,
    last_registered_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,
    user_id INTEGER,

    CONSTRAINT push_notification_tokens_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE rate_limits (
    id SERIAL NOT NULL,
    user_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    window_start TIMESTAMP(3) NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT rate_limits_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE developer_api_keys (
    id SERIAL NOT NULL,
    user_id INTEGER NOT NULL,
    key_hash TEXT NOT NULL,
    display_key TEXT NOT NULL,
    name TEXT,
    tier DEVELOPERAPITIER NOT NULL DEFAULT 'STARTER',
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

-- CreateTable
CREATE TABLE device_logins (
    id SERIAL NOT NULL,
    device_code TEXT NOT NULL,
    user_code TEXT NOT NULL,
    status DEVICE_LOGINSSTATUS NOT NULL DEFAULT 'PENDING',
    user_id INTEGER,
    poll_interval INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP(3) NOT NULL,
    authorized_at TIMESTAMP(3),
    completed_at TIMESTAMP(3),
    last_polled_at TIMESTAMP(3),

    CONSTRAINT device_logins_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE tasks (
    task_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    user_id TEXT,
    model_id TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP(3) NOT NULL,

    CONSTRAINT tasks_pkey PRIMARY KEY (task_id)
);

-- CreateTable
CREATE TABLE audit_logs (
    id SERIAL NOT NULL,
    timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    resource_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    details JSONB,
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,

    CONSTRAINT audit_logs_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE webhook_events (
    id SERIAL NOT NULL,
    stripe_event_id TEXT NOT NULL,
    type TEXT NOT NULL,
    processed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT webhook_events_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE token_usage (
    id SERIAL NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    task_id TEXT,
    conversation_id INTEGER,
    user_id TEXT,
    plan TEXT,
    model TEXT,
    stage TEXT,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_micros INTEGER,
    metadata JSONB,

    CONSTRAINT token_usage_pkey PRIMARY KEY (id)
);

-- CreateTable
CREATE TABLE tool_usage (
    id SERIAL NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    task_id TEXT,
    conversation_id INTEGER,
    user_id TEXT,
    plan TEXT,
    tool_name TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    duration_ms INTEGER,
    error TEXT,
    metadata JSONB,

    CONSTRAINT tool_usage_pkey PRIMARY KEY (id)
);

-- CreateIndex
CREATE UNIQUE INDEX users_username_key ON users (username);

-- CreateIndex
CREATE UNIQUE INDEX users_email_key ON users (email);

-- CreateIndex
CREATE INDEX users_plan_idx ON users (plan);

-- CreateIndex
CREATE INDEX users_is_admin_idx ON users (is_admin);

-- CreateIndex
CREATE INDEX users_subscription_status_idx ON users (subscription_status);

-- CreateIndex
CREATE UNIQUE INDEX accounts_provider_provideraccountid_key ON accounts (provider, provideraccountid);

-- CreateIndex
CREATE UNIQUE INDEX sessions_sessiontoken_key ON sessions (sessiontoken);

-- CreateIndex
CREATE UNIQUE INDEX verification_tokens_token_key ON verification_tokens (token);

-- CreateIndex
CREATE UNIQUE INDEX verification_tokens_identifier_token_key ON verification_tokens (identifier, token);

-- CreateIndex
CREATE INDEX conversations_user_id_idx ON conversations (user_id);

-- CreateIndex
CREATE INDEX conversations_timestamp_idx ON conversations (timestamp);

-- CreateIndex
CREATE INDEX conversations_sync_version_idx ON conversations (sync_version);

-- CreateIndex
CREATE INDEX conversations_last_synced_at_idx ON conversations (last_synced_at);

-- CreateIndex
CREATE INDEX conversations_user_id_is_deleted_idx ON conversations (user_id, is_deleted);

-- CreateIndex
CREATE UNIQUE INDEX messages_message_id_key ON messages (message_id);

-- CreateIndex
CREATE INDEX messages_conversation_id_created_at_idx ON messages (conversation_id, created_at);

-- CreateIndex
CREATE INDEX messages_message_id_idx ON messages (message_id);

-- CreateIndex
CREATE INDEX messages_sync_version_idx ON messages (sync_version);

-- CreateIndex
CREATE INDEX messages_last_synced_at_idx ON messages (last_synced_at);

-- CreateIndex
CREATE INDEX metrics_metric_name_idx ON metrics (metric_name);

-- CreateIndex
CREATE INDEX metrics_timestamp_idx ON metrics (timestamp);

-- CreateIndex
CREATE INDEX downloads_product_idx ON downloads (product);

-- CreateIndex
CREATE INDEX downloads_platform_idx ON downloads (platform);

-- CreateIndex
CREATE INDEX downloads_timestamp_idx ON downloads (timestamp);

-- CreateIndex
CREATE INDEX downloads_product_platform_idx ON downloads (product, platform);

-- CreateIndex
CREATE UNIQUE INDEX push_notification_tokens_token_key ON push_notification_tokens (token);

-- CreateIndex
CREATE INDEX push_notification_tokens_user_id_idx ON push_notification_tokens (user_id);

-- CreateIndex
CREATE INDEX rate_limits_user_id_idx ON rate_limits (user_id);

-- CreateIndex
CREATE INDEX rate_limits_window_start_idx ON rate_limits (window_start);

-- CreateIndex
CREATE UNIQUE INDEX rate_limits_user_id_plan_window_start_key ON rate_limits (user_id, plan, window_start);

-- CreateIndex
CREATE UNIQUE INDEX developer_api_keys_key_hash_key ON developer_api_keys (key_hash);

-- CreateIndex
CREATE INDEX developer_api_keys_user_id_idx ON developer_api_keys (user_id);

-- CreateIndex
CREATE INDEX developer_api_keys_tier_idx ON developer_api_keys (tier);

-- CreateIndex
CREATE INDEX developer_api_usage_window_end_idx ON developer_api_usage (window_end);

-- CreateIndex
CREATE UNIQUE INDEX developer_api_usage_api_key_id_window_start_key ON developer_api_usage (api_key_id, window_start);

-- CreateIndex
CREATE UNIQUE INDEX device_logins_device_code_key ON device_logins (device_code);

-- CreateIndex
CREATE UNIQUE INDEX device_logins_user_code_key ON device_logins (user_code);

-- CreateIndex
CREATE INDEX device_logins_expires_at_idx ON device_logins (expires_at);

-- CreateIndex
CREATE INDEX device_logins_status_idx ON device_logins (status);

-- CreateIndex
CREATE INDEX tasks_expires_at_idx ON tasks (expires_at);

-- CreateIndex
CREATE INDEX audit_logs_user_id_idx ON audit_logs (user_id);

-- CreateIndex
CREATE INDEX audit_logs_action_idx ON audit_logs (action);

-- CreateIndex
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource);

-- CreateIndex
CREATE INDEX audit_logs_timestamp_idx ON audit_logs (timestamp);

-- CreateIndex
CREATE UNIQUE INDEX webhook_events_stripe_event_id_key ON webhook_events (stripe_event_id);

-- CreateIndex
CREATE INDEX webhook_events_stripe_event_id_idx ON webhook_events (stripe_event_id);

-- CreateIndex
CREATE INDEX webhook_events_type_idx ON webhook_events (type);

-- CreateIndex
CREATE INDEX token_usage_created_at_idx ON token_usage (created_at);

-- CreateIndex
CREATE INDEX token_usage_user_id_idx ON token_usage (user_id);

-- CreateIndex
CREATE INDEX token_usage_plan_idx ON token_usage (plan);

-- CreateIndex
CREATE INDEX tool_usage_created_at_idx ON tool_usage (created_at);

-- CreateIndex
CREATE INDEX tool_usage_tool_name_idx ON tool_usage (tool_name);

-- CreateIndex
CREATE INDEX tool_usage_user_id_idx ON tool_usage (user_id);

-- AddForeignKey
ALTER TABLE accounts ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (
    id
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (
    id
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE messages ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (
    conversation_id
) REFERENCES conversations (id) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE push_notification_tokens ADD CONSTRAINT push_notification_tokens_user_id_fkey FOREIGN KEY (
    user_id
) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE developer_api_keys ADD CONSTRAINT developer_api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (
    id
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE developer_api_usage ADD CONSTRAINT developer_api_usage_api_key_id_fkey FOREIGN KEY (
    api_key_id
) REFERENCES developer_api_keys (id) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE device_logins ADD CONSTRAINT device_logins_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (
    id
) ON DELETE CASCADE ON UPDATE CASCADE;
