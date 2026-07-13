-- name: GetConversation :one
SELECT * FROM conversations
WHERE id = $1 AND is_deleted = false;

-- name: GetConversationByUserAndID :one
SELECT * FROM conversations
WHERE id = $1 AND user_id = $2 AND organization_id IS null AND is_deleted = false;

-- name: GetConversationByUserOrgAndID :one
SELECT * FROM conversations
WHERE id = $1 AND user_id = $2 AND organization_id = $3 AND is_deleted = false;

-- name: GetConversationsByUser :many
SELECT * FROM conversations
WHERE user_id = $1 AND organization_id IS null AND is_deleted = false
ORDER BY timestamp DESC
LIMIT $2 OFFSET $3;

-- name: GetConversationsByUserAndOrg :many
SELECT * FROM conversations
WHERE user_id = $1 AND organization_id = $2 AND is_deleted = false
ORDER BY timestamp DESC
LIMIT $3 OFFSET $4;

-- name: CountAllConversations :one
SELECT COUNT(*) FROM conversations;

-- name: CountConversationsByUser :one
SELECT COUNT(*) FROM conversations
WHERE user_id = $1 AND organization_id IS null AND is_deleted = false;

-- name: CountConversationsByUserAndOrg :one
SELECT COUNT(*) FROM conversations
WHERE user_id = $1 AND organization_id = $2 AND is_deleted = false;

-- name: CountConversationsByOrg :one
SELECT COUNT(*) FROM conversations
WHERE organization_id = $1 AND is_deleted = false;

-- name: CreateConversation :one
INSERT INTO conversations (user_id, organization_id, user_input, model, agent_count, device_id, project_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdateConversation :exec
UPDATE conversations SET
    user_input = COALESCE(sqlc.narg('user_input'), user_input),
    organization_id = COALESCE(sqlc.narg('organization_id'), organization_id),
    result = COALESCE(sqlc.narg('result'), result),
    execution_time = COALESCE(sqlc.narg('execution_time'), execution_time),
    model = COALESCE(sqlc.narg('model'), model),
    agent_count = COALESCE(sqlc.narg('agent_count'), agent_count),
    sync_version = NEXTVAL('sync_version_seq'),
    last_synced_at = NOW(),
    updated_at = NOW()
WHERE id = sqlc.arg('id') AND user_id = sqlc.arg('user_id') AND organization_id IS null;

-- name: UpdateConversationWithOrg :exec
UPDATE conversations SET
    user_input = COALESCE(sqlc.narg('user_input'), user_input),
    result = COALESCE(sqlc.narg('result'), result),
    execution_time = COALESCE(sqlc.narg('execution_time'), execution_time),
    model = COALESCE(sqlc.narg('model'), model),
    agent_count = COALESCE(sqlc.narg('agent_count'), agent_count),
    sync_version = NEXTVAL('sync_version_seq'),
    last_synced_at = NOW(),
    updated_at = NOW()
WHERE id = sqlc.arg('id') AND user_id = sqlc.arg('user_id') AND organization_id = sqlc.arg('organization_id');

-- name: SoftDeleteConversation :exec
UPDATE conversations
SET
    is_deleted = true,
    sync_version = NEXTVAL('sync_version_seq'),
    last_synced_at = NOW(),
    updated_at = NOW()
WHERE id = $1 AND user_id = $2 AND organization_id IS null;

-- name: SoftDeleteConversationWithOrg :exec
UPDATE conversations
SET
    is_deleted = true,
    sync_version = NEXTVAL('sync_version_seq'),
    last_synced_at = NOW(),
    updated_at = NOW()
WHERE id = $1 AND user_id = $2 AND organization_id = $3;

-- name: UpdateConversationSync :exec
UPDATE conversations SET
    user_input = $2,
    organization_id = $3,
    result = $4,
    execution_time = $5,
    model = $6,
    agent_count = $7,
    sync_version = $8,
    last_synced_at = NOW(),
    device_id = $9,
    is_deleted = $10,
    vector_clock = $11,
    updated_at = NOW()
WHERE
    id = $1
    AND (
        (
            sqlc.narg('scope_organization_id')::INT IS null
            AND organization_id IS null
            AND user_id = sqlc.narg('user_id')::TEXT
        )
        OR (
            sqlc.narg('scope_organization_id')::INT IS NOT null
            AND organization_id = sqlc.narg('scope_organization_id')::INT
        )
    );

-- name: CreateConversationSync :one
INSERT INTO conversations (
    user_id, organization_id, user_input, result, execution_time, model, agent_count,
    sync_version, last_synced_at, device_id, is_deleted, timestamp, vector_clock, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, $12, NOW()
)
RETURNING *;

-- name: GetConversationVersion :one
SELECT
    id,
    sync_version,
    vector_clock
FROM conversations
WHERE id = $1 AND user_id = $2 AND organization_id IS null;

-- name: GetConversationVersionWithOrg :one
SELECT
    id,
    sync_version,
    vector_clock
FROM conversations
WHERE
    id = sqlc.arg('id')
    AND organization_id = sqlc.narg('organization_id')::INT
    AND (
        sqlc.narg('user_id')::TEXT IS null
        OR user_id = sqlc.narg('user_id')::TEXT
    );

-- name: GetConversationWithOrg :one
SELECT * FROM conversations
WHERE id = $1 AND organization_id = $2 AND is_deleted = false;

-- name: GetLatestSyncVersion :one
SELECT GREATEST(
    (
        SELECT COALESCE(MAX(sync_version), 0) FROM conversations AS c2
        WHERE c2.user_id = $1 AND c2.organization_id IS null
    ),
    (
        SELECT COALESCE(MAX(m.sync_version), 0) FROM messages AS m JOIN conversations AS c ON m.conversation_id = c.id
        WHERE c.user_id = $1 AND c.organization_id IS null
    )
)::INT AS latest_version;

-- name: GetLatestOrgSyncVersion :one
SELECT GREATEST(
    (
        SELECT COALESCE(MAX(sync_version), 0) FROM conversations AS c2
        WHERE c2.organization_id = $1
    ),
    (
        SELECT COALESCE(MAX(m.sync_version), 0) FROM messages AS m JOIN conversations AS c ON m.conversation_id = c.id
        WHERE c.organization_id = $1
    )
)::INT AS latest_version;

-- name: GetConversationsAfterVersion :many
SELECT * FROM conversations
WHERE user_id = $1 AND organization_id IS null AND sync_version > $2
ORDER BY sync_version
LIMIT $3;

-- name: GetConversationsByOrgAfterVersion :many
SELECT * FROM conversations
WHERE organization_id = $1 AND sync_version > $2
ORDER BY organization_id, sync_version
LIMIT $3;

-- name: UpdateConversationSharing :one
UPDATE conversations
SET
    is_public = $2,
    share_id = $3,
    public_shared_at = CASE WHEN $2 THEN NOW() END,
    sync_version = NEXTVAL('sync_version_seq'),
    last_synced_at = NOW(),
    updated_at = NOW()
WHERE id = $1 AND user_id = $4 AND organization_id IS null
RETURNING *;

-- name: UpdateConversationSharingWithOrg :one
UPDATE conversations
SET
    is_public = $2,
    share_id = $3,
    public_shared_at = CASE WHEN $2 THEN NOW() END,
    sync_version = NEXTVAL('sync_version_seq'),
    last_synced_at = NOW(),
    updated_at = NOW()
WHERE id = $1 AND user_id = $4 AND organization_id = $5
RETURNING *;

-- name: GetConversationByShareID :one
SELECT * FROM conversations
WHERE
    share_id = $1
    AND is_public = true
    AND is_deleted = false
    AND public_shared_at IS NOT null
LIMIT 1;

-- name: GetPublicMessagesByConversationID :many
SELECT
    message_id,
    role,
    content,
    is_agent_status,
    created_at
FROM messages
WHERE
    conversation_id = sqlc.arg(conversation_id)
    AND is_deleted = false
    AND created_at <= sqlc.arg(public_shared_at)
ORDER BY created_at ASC;
