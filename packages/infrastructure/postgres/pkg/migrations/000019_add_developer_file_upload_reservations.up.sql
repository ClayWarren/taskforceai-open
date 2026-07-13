CREATE TABLE developer_file_upload_reservations (
    file_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    blob_path TEXT NOT NULL,
    reserved_bytes BIGINT NOT NULL,
    expires_at TIMESTAMP(3) NOT NULL,
    completed_at TIMESTAMP(3),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT developer_file_upload_reservations_pkey PRIMARY KEY (file_id),
    CONSTRAINT developer_file_upload_reservations_reserved_bytes_positive CHECK (reserved_bytes > 0),
    CONSTRAINT developer_file_upload_reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (
        id
    ) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX developer_file_upload_reservations_blob_path_key ON developer_file_upload_reservations (blob_path);
CREATE INDEX developer_file_upload_reservations_user_expires_idx ON developer_file_upload_reservations (user_id, expires_at)
WHERE completed_at IS null;
