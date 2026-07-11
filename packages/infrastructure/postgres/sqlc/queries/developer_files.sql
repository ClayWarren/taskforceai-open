-- name: EnsureUserStorageQuota :exec
INSERT INTO user_storage_quotas (user_id)
VALUES ($1)
ON CONFLICT (user_id) DO NOTHING;

-- name: GetUserStorageQuota :one
SELECT * FROM user_storage_quotas
WHERE user_id = $1;

-- name: ReserveUserStorageBytes :one
UPDATE user_storage_quotas
SET used_bytes = used_bytes + $2, updated_at = CURRENT_TIMESTAMP
WHERE
    user_id = $1
    AND used_bytes + $2 <= quota_bytes
RETURNING *;

-- name: ReleaseUserStorageBytes :one
UPDATE user_storage_quotas
SET used_bytes = GREATEST(0, used_bytes - $2), updated_at = CURRENT_TIMESTAMP
WHERE user_id = $1
RETURNING *;

-- name: CreateDeveloperFile :one
INSERT INTO developer_files (
    id,
    user_id,
    organization_id,
    filename,
    purpose,
    mime_type,
    bytes,
    blob_url,
    blob_path,
    updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
RETURNING *;

-- name: GetDeveloperFileByIDForUser :one
SELECT * FROM developer_files
WHERE
    id = $1
    AND user_id = $2
    AND deleted_at IS NULL;

-- name: ListDeveloperFilesByUser :many
SELECT * FROM developer_files
WHERE
    user_id = $1
    AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountDeveloperFilesByUser :one
SELECT COUNT(*) FROM developer_files
WHERE
    user_id = $1
    AND deleted_at IS NULL;

-- name: MarkDeveloperFileDeleted :one
UPDATE developer_files
SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE
    id = $1
    AND user_id = $2
    AND deleted_at IS NULL
RETURNING *;

-- name: RestoreDeveloperFileDeletion :exec
UPDATE developer_files
SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
WHERE
    id = $1
    AND user_id = $2;
