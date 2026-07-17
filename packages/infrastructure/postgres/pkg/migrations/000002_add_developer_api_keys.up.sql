-- Complete the pre-organization baseline that is required by migrations 3+.
-- The original version of this migration duplicated developer_api_keys from
-- migration 1 and made an empty-database migration fail immediately.

CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

DROP INDEX IF EXISTS users_username_key;

ALTER TABLE users
ALTER COLUMN email SET NOT NULL,
DROP COLUMN username,
DROP COLUMN hashed_password,
ADD COLUMN memory_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN web_search_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN code_execution_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN notifications_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN quick_mode_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE organizations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    domain TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    subscription_id TEXT,
    subscription_status TEXT,
    customer_id TEXT,
    workos_organization_id TEXT,
    no_training BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE memberships (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL
);

CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    organization_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    custom_instructions TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL
);

CREATE TABLE memories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'fact',
    metadata JSONB,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL
);

CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    avatar TEXT,
    autonomy_enabled BOOLEAN NOT NULL DEFAULT false,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    active_start TEXT NOT NULL DEFAULT '09:00',
    active_end TEXT NOT NULL DEFAULT '17:00',
    active_days INTEGER [],
    check_interval INTEGER NOT NULL DEFAULT 600,
    last_run_at TIMESTAMP(3),
    next_run_at TIMESTAMP(3),
    status TEXT NOT NULL DEFAULT 'IDLE',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL
);

CREATE TABLE sync_audit_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    action TEXT NOT NULL,
    version_start INTEGER NOT NULL,
    version_end INTEGER NOT NULL,
    items_count INTEGER NOT NULL DEFAULT 0,
    conflicts_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    details JSONB
);

CREATE TABLE sync_devices (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT,
    user_agent TEXT,
    last_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_revoked BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE conversations
ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN share_id TEXT,
ADD COLUMN project_id INTEGER,
ADD COLUMN organization_id INTEGER,
ADD COLUMN deleted_at TIMESTAMP(3),
ADD COLUMN vector_clock JSONB;

ALTER TABLE messages
ADD COLUMN deleted_at TIMESTAMP(3),
ADD COLUMN vector_clock JSONB;

ALTER TABLE audit_logs
DROP COLUMN username,
ADD COLUMN organization_id INTEGER;

CREATE UNIQUE INDEX organizations_slug_key ON organizations (slug);
CREATE UNIQUE INDEX organizations_domain_key ON organizations (domain);
CREATE UNIQUE INDEX organizations_workos_organization_id_key ON organizations (workos_organization_id);
CREATE INDEX memberships_user_id_idx ON memberships (user_id);
CREATE UNIQUE INDEX memberships_organization_id_user_id_key ON memberships (organization_id, user_id);
CREATE INDEX projects_user_id_idx ON projects (user_id);
CREATE INDEX projects_organization_id_idx ON projects (organization_id);
CREATE INDEX memories_user_id_idx ON memories (user_id);
CREATE INDEX agents_user_id_idx ON agents (user_id);
CREATE INDEX agents_autonomy_enabled_idx ON agents (autonomy_enabled);
CREATE INDEX sync_audit_logs_user_id_idx ON sync_audit_logs (user_id);
CREATE INDEX sync_audit_logs_timestamp_idx ON sync_audit_logs (timestamp);
CREATE UNIQUE INDEX sync_devices_user_id_device_id_key ON sync_devices (user_id, device_id);
CREATE INDEX audit_logs_organization_id_idx ON audit_logs (organization_id);
CREATE INDEX conversations_organization_id_idx ON conversations (organization_id);
CREATE INDEX conversations_project_id_idx ON conversations (project_id);
CREATE INDEX conversations_user_id_timestamp_idx ON conversations (user_id, timestamp);
CREATE INDEX tasks_user_id_created_at_idx ON tasks (user_id, created_at);
CREATE INDEX token_usage_user_id_created_at_idx ON token_usage (user_id, created_at);
CREATE INDEX tool_usage_user_id_created_at_idx ON tool_usage (user_id, created_at);
CREATE UNIQUE INDEX conversations_share_id_key ON conversations (share_id);

ALTER TABLE memberships ADD CONSTRAINT memberships_organization_id_fkey FOREIGN KEY (organization_id)
REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE memberships ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id)
REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE projects ADD CONSTRAINT projects_user_id_fkey FOREIGN KEY (user_id)
REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE projects ADD CONSTRAINT projects_organization_id_fkey FOREIGN KEY (organization_id)
REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE memories ADD CONSTRAINT memories_user_id_fkey FOREIGN KEY (user_id)
REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE agents ADD CONSTRAINT agents_user_id_fkey FOREIGN KEY (user_id)
REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE conversations ADD CONSTRAINT conversations_project_id_fkey FOREIGN KEY (project_id)
REFERENCES projects (id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE conversations ADD CONSTRAINT conversations_organization_id_fkey FOREIGN KEY (organization_id)
REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_organization_id_fkey FOREIGN KEY (organization_id)
REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE;
