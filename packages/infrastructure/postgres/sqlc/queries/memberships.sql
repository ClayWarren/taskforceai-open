-- name: CreateMembership :one
INSERT INTO memberships (organization_id, user_id, role, updated_at)
VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
RETURNING *;

-- name: GetMembershipsForUser :many
SELECT
    m.*,
    o.name AS organization_name,
    o.slug AS organization_slug
FROM memberships AS m
JOIN organizations AS o ON m.organization_id = o.id
WHERE m.user_id = $1;

-- name: GetMembership :one
SELECT * FROM memberships
WHERE organization_id = $1 AND user_id = $2;

-- name: UpdateMembershipRole :one
UPDATE memberships
SET role = $3, updated_at = CURRENT_TIMESTAMP
WHERE organization_id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteMembership :exec
DELETE FROM memberships
WHERE organization_id = $1 AND user_id = $2;

-- name: GetOrganizationMembers :many
SELECT
    m.*,
    u.email,
    u.full_name
FROM memberships AS m
JOIN users AS u ON m.user_id = u.id
WHERE m.organization_id = $1;
