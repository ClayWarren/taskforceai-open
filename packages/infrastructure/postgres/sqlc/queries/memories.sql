-- name: CreateMemory :one
INSERT INTO memories (user_id, organization_id, content, type, metadata, updated_at)
VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
RETURNING *;

-- name: GetUserMemories :many
SELECT * FROM memories
WHERE user_id = $1 AND organization_id IS NULL
ORDER BY created_at DESC;

-- name: GetUserMemoriesWithOrg :many
SELECT * FROM memories
WHERE user_id = $1 AND organization_id = $2
ORDER BY created_at DESC;

-- name: UpdateMemory :one
UPDATE memories
SET content = $2, type = $3, metadata = $4, updated_at = CURRENT_TIMESTAMP
WHERE id = $1 AND user_id = $5 AND organization_id IS NULL
RETURNING *;

-- name: UpdateMemoryWithOrg :one
UPDATE memories
SET content = $2, type = $3, metadata = $4, updated_at = CURRENT_TIMESTAMP
WHERE id = $1 AND user_id = $5 AND organization_id = $6
RETURNING *;

-- name: DeleteMemory :exec
DELETE FROM memories
WHERE id = $1 AND user_id = $2 AND organization_id IS NULL;

-- name: DeleteMemoryWithOrg :exec
DELETE FROM memories
WHERE id = $1 AND user_id = $2 AND organization_id = $3;
