CREATE TABLE user_storage_quotas (
    user_id INTEGER NOT NULL,
    quota_bytes BIGINT NOT NULL DEFAULT 42949672960,
    used_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT user_storage_quotas_pkey PRIMARY KEY (user_id),
    CONSTRAINT user_storage_quotas_quota_nonnegative CHECK (quota_bytes >= 0),
    CONSTRAINT user_storage_quotas_used_nonnegative CHECK (used_bytes >= 0),
    CONSTRAINT user_storage_quotas_used_lte_quota CHECK (used_bytes <= quota_bytes),
    CONSTRAINT user_storage_quotas_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE developer_files (
    id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    organization_id INTEGER,
    filename TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'assistants',
    mime_type TEXT NOT NULL,
    bytes BIGINT NOT NULL,
    blob_url TEXT NOT NULL,
    blob_path TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP(3),

    CONSTRAINT developer_files_pkey PRIMARY KEY (id),
    CONSTRAINT developer_files_bytes_nonnegative CHECK (bytes >= 0),
    CONSTRAINT developer_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT developer_files_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX developer_files_blob_url_key ON developer_files (blob_url);
CREATE UNIQUE INDEX developer_files_blob_path_key ON developer_files (blob_path);
CREATE INDEX developer_files_user_id_created_at_idx ON developer_files (user_id, created_at DESC);
CREATE INDEX developer_files_user_id_deleted_at_idx ON developer_files (user_id, deleted_at);
