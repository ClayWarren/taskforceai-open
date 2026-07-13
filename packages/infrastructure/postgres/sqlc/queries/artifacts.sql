-- name: CreateArtifact :one
INSERT INTO artifacts (
    id,
    organization_id,
    owner_user_id,
    conversation_id,
    message_id,
    task_id,
    type,
    title,
    status,
    visibility,
    metadata,
    updated_at
)
VALUES (
    sqlc.arg('id'),
    sqlc.narg('organization_id'),
    sqlc.arg('owner_user_id'),
    sqlc.narg('conversation_id'),
    sqlc.narg('message_id'),
    sqlc.narg('task_id'),
    sqlc.arg('type')::"ArtifactType",
    sqlc.arg('title'),
    sqlc.arg('status')::"ArtifactStatus",
    sqlc.arg('visibility')::"ArtifactVisibility",
    sqlc.narg('metadata'),
    CURRENT_TIMESTAMP
)
RETURNING *;

-- name: CreateArtifactVersion :one
INSERT INTO artifact_versions (
    id,
    artifact_id,
    version,
    file_id,
    mime_type,
    filename,
    bytes,
    render_metadata,
    source_tool_name,
    source_prompt,
    created_by_user_id
)
VALUES (
    sqlc.arg('id'),
    sqlc.arg('artifact_id'),
    sqlc.arg('version'),
    sqlc.narg('file_id'),
    sqlc.narg('mime_type'),
    sqlc.narg('filename'),
    sqlc.narg('bytes'),
    sqlc.narg('render_metadata'),
    sqlc.narg('source_tool_name'),
    sqlc.narg('source_prompt'),
    sqlc.narg('created_by_user_id')
)
RETURNING *;

-- name: SetArtifactCurrentVersion :one
UPDATE artifacts
SET current_version_id = sqlc.arg('current_version_id'), updated_at = CURRENT_TIMESTAMP
WHERE
    id = sqlc.arg('id')
    AND owner_user_id = sqlc.arg('owner_user_id')
    AND (
        (sqlc.narg('organization_id')::INT IS NULL AND organization_id IS NULL)
        OR organization_id = sqlc.narg('organization_id')::INT
    )
    AND deleted_at IS NULL
RETURNING *;

-- name: GetArtifactByIDForUser :one
SELECT * FROM artifacts
WHERE
    id = sqlc.arg('id')
    AND (
        (
            owner_user_id = sqlc.arg('owner_user_id')
            AND (
                (sqlc.narg('organization_id')::INT IS NULL AND organization_id IS NULL)
                OR organization_id = sqlc.narg('organization_id')::INT
            )
        )
        OR (
            sqlc.narg('organization_id')::INT IS NOT NULL
            AND organization_id = sqlc.narg('organization_id')::INT
            AND visibility = 'ORGANIZATION'::"ArtifactVisibility"
        )
    )
    AND deleted_at IS NULL
LIMIT 1;

-- name: ListArtifactsForUser :many
SELECT * FROM artifacts
WHERE
    owner_user_id = sqlc.arg('owner_user_id')
    AND organization_id IS NULL
    AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: ListArtifactsForUserAndOrg :many
SELECT * FROM artifacts
WHERE
    organization_id = sqlc.arg('organization_id')
    AND (
        owner_user_id = sqlc.arg('owner_user_id')
        OR visibility = 'ORGANIZATION'::"ArtifactVisibility"
    )
    AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: GetArtifactVersionsForUser :many
SELECT av.*
FROM artifact_versions AS av
JOIN artifacts AS a ON av.artifact_id = a.id
WHERE
    av.artifact_id = sqlc.arg('artifact_id')
    AND (
        (
            a.owner_user_id = sqlc.arg('owner_user_id')
            AND (
                (sqlc.narg('organization_id')::INT IS NULL AND a.organization_id IS NULL)
                OR a.organization_id = sqlc.narg('organization_id')::INT
            )
        )
        OR (
            sqlc.narg('organization_id')::INT IS NOT NULL
            AND a.organization_id = sqlc.narg('organization_id')::INT
            AND a.visibility = 'ORGANIZATION'::"ArtifactVisibility"
        )
    )
    AND a.deleted_at IS NULL
ORDER BY av.version DESC;

-- name: UpdateArtifactVisibilityForOwner :one
UPDATE artifacts
SET
    visibility = sqlc.arg('visibility')::"ArtifactVisibility",
    updated_at = CURRENT_TIMESTAMP
WHERE
    id = sqlc.arg('id')
    AND owner_user_id = sqlc.arg('owner_user_id')
    AND (
        (sqlc.narg('organization_id')::INT IS NULL AND organization_id IS NULL)
        OR organization_id = sqlc.narg('organization_id')::INT
    )
    AND deleted_at IS NULL
RETURNING *;

-- name: CreateArtifactPublicLinkShare :one
INSERT INTO artifact_shares (
    id,
    artifact_id,
    organization_id,
    scope,
    token_hash,
    permission
)
SELECT
    sqlc.arg('id') AS share_id,
    a.id AS artifact_id,
    a.organization_id AS source_organization_id,
    'PUBLIC_LINK'::"ArtifactShareScope" AS public_scope,
    sqlc.arg('token_hash') AS public_token_hash,
    'VIEW'::"ArtifactPermission" AS public_permission
FROM artifacts AS a
WHERE
    a.id = sqlc.arg('artifact_id')
    AND a.owner_user_id = sqlc.arg('owner_user_id')
    AND (
        (sqlc.narg('organization_id')::INT IS NULL AND a.organization_id IS NULL)
        OR a.organization_id = sqlc.narg('organization_id')::INT
    )
    AND a.deleted_at IS NULL
RETURNING *;

-- name: RevokeArtifactPublicLinkSharesForOwner :exec
UPDATE artifact_shares AS artifact_shares
SET revoked_at = CURRENT_TIMESTAMP
FROM artifacts AS a
WHERE
    artifact_shares.artifact_id = a.id
    AND a.id = sqlc.arg('artifact_id')
    AND a.owner_user_id = sqlc.arg('owner_user_id')
    AND (
        (sqlc.narg('organization_id')::INT IS NULL AND a.organization_id IS NULL)
        OR a.organization_id = sqlc.narg('organization_id')::INT
    )
    AND artifact_shares.scope = 'PUBLIC_LINK'::"ArtifactShareScope"
    AND artifact_shares.revoked_at IS NULL
    AND a.deleted_at IS NULL;

-- name: GetPublicArtifactByTokenHash :one
SELECT
    sqlc.embed(a), -- noqa: AL03, RF02
    sqlc.embed(av), -- noqa: AL03, RF02
    sqlc.embed(s) -- noqa: AL03, RF02
FROM artifact_shares AS s
JOIN artifacts AS a ON s.artifact_id = a.id
JOIN artifact_versions AS av ON a.current_version_id = av.id
WHERE
    s.token_hash = sqlc.arg('token_hash')
    AND s.scope = 'PUBLIC_LINK'::"ArtifactShareScope"
    AND s.permission = 'VIEW'::"ArtifactPermission"
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
    AND a.status = 'READY'::"ArtifactStatus"
    AND a.deleted_at IS NULL
LIMIT 1;

-- name: GetPublicArtifactFileByTokenHash :one
SELECT df.*
FROM artifact_shares AS s
JOIN artifacts AS a ON s.artifact_id = a.id
JOIN artifact_versions AS av ON a.current_version_id = av.id
JOIN developer_files AS df ON av.file_id = df.id
WHERE
    s.token_hash = sqlc.arg('token_hash')
    AND s.scope = 'PUBLIC_LINK'::"ArtifactShareScope"
    AND s.permission = 'VIEW'::"ArtifactPermission"
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
    AND a.status = 'READY'::"ArtifactStatus"
    AND a.deleted_at IS NULL
    AND df.deleted_at IS NULL
LIMIT 1;

-- name: SoftDeleteArtifactForUser :one
UPDATE artifacts
SET
    status = 'DELETED'::"ArtifactStatus",
    deleted_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE
    id = sqlc.arg('id')
    AND owner_user_id = sqlc.arg('owner_user_id')
    AND (
        (sqlc.narg('organization_id')::INT IS NULL AND organization_id IS NULL)
        OR organization_id = sqlc.narg('organization_id')::INT
    )
    AND deleted_at IS NULL
RETURNING *;
