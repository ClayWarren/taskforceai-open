-- name: GetOrganizationByID :one
SELECT * FROM organizations
WHERE id = $1;

-- name: GetOrganizationByDomain :one
SELECT * FROM organizations
WHERE domain = $1;

-- name: GetOrganizationByWorkosID :one
SELECT * FROM organizations
WHERE workos_organization_id = $1;

-- name: UpdateOrganization :one
UPDATE organizations
SET name = $2, slug = $3, domain = $4, updated_at = CURRENT_TIMESTAMP
WHERE id = $1
RETURNING *;

-- name: GetOrganizationSettings :one
SELECT settings FROM organizations
WHERE id = $1;

-- name: UpdateOrganizationSettings :exec
UPDATE organizations SET settings = $2
WHERE id = $1;
