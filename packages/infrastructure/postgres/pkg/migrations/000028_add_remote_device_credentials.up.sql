CREATE TABLE remote_device_credentials (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    credential_hash TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT remote_device_credentials_pkey PRIMARY KEY (user_id, device_id),
    CONSTRAINT remote_device_credentials_hash_length CHECK (LENGTH(credential_hash) = 64)
);
