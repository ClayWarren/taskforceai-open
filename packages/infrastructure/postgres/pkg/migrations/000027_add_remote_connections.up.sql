CREATE TABLE remote_targets (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    allow_connections BOOLEAN NOT NULL DEFAULT false,
    keep_awake BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT remote_targets_user_id_device_id_key UNIQUE (user_id, device_id)
);

CREATE INDEX remote_targets_user_id_idx ON remote_targets (user_id);

CREATE TABLE remote_connections (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    target_device_id TEXT NOT NULL,
    controller_device_id TEXT NOT NULL,
    capabilities TEXT [] NOT NULL DEFAULT ARRAY['threads', 'approvals', 'files']::TEXT [],
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP(3),
    CONSTRAINT remote_connections_user_id_target_device_id_controller_device_id_key UNIQUE (
        user_id,
        target_device_id,
        controller_device_id
    )
);

CREATE INDEX remote_connections_user_id_controller_device_id_idx
ON remote_connections (user_id, controller_device_id);

CREATE INDEX remote_connections_user_id_target_device_id_idx
ON remote_connections (user_id, target_device_id);
