CREATE TYPE "ArtifactType" AS ENUM (
    'DOCUMENT',
    'SPREADSHEET',
    'CHART',
    'IMAGE',
    'VIDEO',
    'SITE',
    'DASHBOARD',
    'ARCHIVE',
    'OTHER'
);

CREATE TYPE "ArtifactStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED', 'DELETED');

CREATE TYPE "ArtifactVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION', 'PUBLIC_LINK');

CREATE TYPE "ArtifactShareScope" AS ENUM ('ORGANIZATION', 'PUBLIC_LINK', 'USER');

CREATE TYPE "ArtifactPermission" AS ENUM ('VIEW', 'COMMENT', 'EDIT');

CREATE TABLE artifacts (
    id TEXT NOT NULL,
    organization_id INTEGER,
    owner_user_id INTEGER NOT NULL,
    conversation_id INTEGER,
    message_id TEXT,
    task_id TEXT,
    type "ArtifactType" NOT NULL,
    title TEXT NOT NULL,
    status "ArtifactStatus" NOT NULL DEFAULT 'READY',
    visibility "ArtifactVisibility" NOT NULL DEFAULT 'PRIVATE',
    current_version_id TEXT,
    metadata JSONB,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP(3),

    CONSTRAINT artifacts_pkey PRIMARY KEY (id)
);

CREATE TABLE artifact_versions (
    id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    file_id TEXT,
    mime_type TEXT,
    filename TEXT,
    bytes BIGINT,
    render_metadata JSONB,
    source_tool_name TEXT,
    source_prompt TEXT,
    created_by_user_id INTEGER,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT artifact_versions_pkey PRIMARY KEY (id),
    CONSTRAINT artifact_versions_bytes_nonnegative CHECK (bytes IS NULL OR bytes >= 0),
    CONSTRAINT artifact_versions_version_positive CHECK (version > 0)
);

CREATE TABLE artifact_shares (
    id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    organization_id INTEGER,
    scope "ArtifactShareScope" NOT NULL,
    target_user_id INTEGER,
    token_hash TEXT,
    permission "ArtifactPermission" NOT NULL DEFAULT 'VIEW',
    expires_at TIMESTAMP(3),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP(3),

    CONSTRAINT artifact_shares_pkey PRIMARY KEY (id),
    CONSTRAINT artifact_shares_scope_target_check CHECK (
        (scope = 'ORGANIZATION' AND organization_id IS NOT NULL AND target_user_id IS NULL AND token_hash IS NULL)
        OR (scope = 'USER' AND target_user_id IS NOT NULL AND token_hash IS NULL)
        OR (scope = 'PUBLIC_LINK' AND token_hash IS NOT NULL AND target_user_id IS NULL)
    )
);

CREATE UNIQUE INDEX artifacts_current_version_id_key ON artifacts (current_version_id);
CREATE INDEX artifacts_organization_id_idx ON artifacts (organization_id);
CREATE INDEX artifacts_owner_user_id_created_at_idx ON artifacts (owner_user_id, created_at);
CREATE INDEX artifacts_conversation_id_idx ON artifacts (conversation_id);
CREATE INDEX artifacts_message_id_idx ON artifacts (message_id);
CREATE INDEX artifacts_task_id_idx ON artifacts (task_id);
CREATE INDEX artifacts_type_idx ON artifacts (type);
CREATE INDEX artifacts_status_idx ON artifacts (status);
CREATE INDEX artifacts_visibility_idx ON artifacts (visibility);

CREATE UNIQUE INDEX artifact_versions_artifact_id_version_key ON artifact_versions (artifact_id, version);
CREATE INDEX artifact_versions_artifact_id_idx ON artifact_versions (artifact_id);
CREATE INDEX artifact_versions_file_id_idx ON artifact_versions (file_id);
CREATE INDEX artifact_versions_created_by_user_id_idx ON artifact_versions (created_by_user_id);

CREATE UNIQUE INDEX artifact_shares_token_hash_key ON artifact_shares (token_hash);
CREATE INDEX artifact_shares_artifact_id_idx ON artifact_shares (artifact_id);
CREATE INDEX artifact_shares_organization_id_idx ON artifact_shares (organization_id);
CREATE INDEX artifact_shares_target_user_id_idx ON artifact_shares (target_user_id);
CREATE INDEX artifact_shares_scope_idx ON artifact_shares (scope);

ALTER TABLE artifacts ADD CONSTRAINT artifacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations (
    id
) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users (
    id
) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations (
    id
) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages (
    message_id
) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE artifact_versions ADD CONSTRAINT artifact_versions_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES artifacts (
    id
) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE artifact_versions ADD CONSTRAINT artifact_versions_file_id_fkey FOREIGN KEY (file_id) REFERENCES developer_files (
    id
) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE artifact_versions ADD CONSTRAINT artifact_versions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users (
    id
) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES artifact_versions (
    id
) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE artifact_shares ADD CONSTRAINT artifact_shares_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES artifacts (
    id
) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE artifact_shares ADD CONSTRAINT artifact_shares_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations (
    id
) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE artifact_shares ADD CONSTRAINT artifact_shares_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users (
    id
) ON DELETE CASCADE ON UPDATE CASCADE;
