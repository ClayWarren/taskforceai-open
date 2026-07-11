-- name: CreateProject :one
INSERT INTO projects (user_id, organization_id, name, description, custom_instructions, updated_at)
VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
RETURNING *;

-- name: GetProjectByID :one
SELECT * FROM projects
WHERE id = $1 AND user_id = $2 AND organization_id IS NULL
LIMIT 1;

-- name: GetProjectByUserOrgAndID :one
SELECT * FROM projects
WHERE id = $1 AND user_id = $2 AND organization_id = $3
LIMIT 1;

-- name: GetProjectsByUser :many
SELECT * FROM projects
WHERE user_id = $1 AND organization_id IS NULL
ORDER BY created_at DESC;

-- name: GetProjectsByUserAndOrg :many
SELECT * FROM projects
WHERE user_id = $1 AND organization_id = $2
ORDER BY created_at DESC;

-- name: DeleteProject :exec
DELETE FROM projects
WHERE id = $1 AND user_id = $2 AND organization_id IS NULL;

-- name: DeleteProjectWithOrg :exec
DELETE FROM projects
WHERE id = $1 AND user_id = $2 AND organization_id = $3;
