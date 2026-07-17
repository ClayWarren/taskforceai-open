-- name: GetMessage :one
SELECT * FROM messages
WHERE id = $1;

-- name: GetMessageByMessageID :one
SELECT * FROM messages
WHERE message_id = $1;

-- name: GetMessageByMessageIDScoped :one
SELECT
    m.id,
    m.message_id,
    m.conversation_id,
    m.role,
    m.content,
    m.is_streaming,
    m.is_agent_status,
    m.elapsed_seconds,
    m.created_at,
    m.error,
    m.sources,
    m.tool_events,
    m.agent_statuses,
    m.vector_clock,
    m.sync_version,
    m.last_synced_at,
    m.device_id,
    m.is_deleted,
    m.updated_at,
    COALESCE((TO_JSONB(m) ->> 'rating')::INTEGER, 0) AS rating,  -- noqa: RF02
    TO_JSONB(m) -> 'trace' AS trace  -- noqa: RF02
FROM messages AS m
JOIN conversations AS c ON m.conversation_id = c.id
WHERE
    m.message_id = sqlc.arg('message_id')
    AND (
        (
            sqlc.narg('organization_id')::INT IS NULL
            AND c.organization_id IS NULL
            AND c.user_id = sqlc.narg('user_id')::TEXT
        )
        OR (
            sqlc.narg('organization_id')::INT IS NOT NULL
            AND c.organization_id = sqlc.narg('organization_id')
        )
    );

-- name: GetMessagesByConversation :many
SELECT * FROM messages
WHERE conversation_id = $1 AND is_deleted = FALSE
ORDER BY created_at;

-- name: GetLatestAssistantMessagesWithMetadataByConversations :many
SELECT DISTINCT ON (conversation_id) * FROM messages
WHERE
    conversation_id = ANY(sqlc.arg(conversation_ids)::INT [])
    AND role = 'assistant'
    AND is_deleted = FALSE
    AND (
        trace IS NOT NULL
        OR sources IS NOT NULL
        OR tool_events IS NOT NULL
        OR agent_statuses IS NOT NULL
    )
ORDER BY conversation_id ASC, created_at DESC, id DESC;

-- name: CreateMessage :one
INSERT INTO messages (
    message_id, conversation_id, role, content, sources, tool_events, agent_statuses, device_id, trace
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: UpdateMessageRating :execrows
UPDATE messages AS m
SET
    rating = $2,
    sync_version = NEXTVAL('sync_version_seq'),
    last_synced_at = NOW(),
    updated_at = NOW()
FROM conversations AS c
WHERE
    m.message_id = $1
    AND m.conversation_id = c.id
    AND c.user_id = $3
    AND ((sqlc.arg(organization_id)::INT = 0 AND c.organization_id IS NULL) OR c.organization_id = sqlc.arg(organization_id));

-- name: UpdateMessageSync :exec
-- AUTHZ-VULN-03: enforce user ownership for personal scope, and org membership
-- scope for organization sync writes.
UPDATE messages SET
    content = $2,
    is_streaming = $3,
    is_agent_status = $4,
    elapsed_seconds = $5,
    error = $6,
    sources = $7,
    tool_events = $8,
    agent_statuses = $9,
    sync_version = $10,
    last_synced_at = NOW(),
    device_id = $11,
    is_deleted = $12,
    vector_clock = $13,
    trace = COALESCE($14, trace),
    updated_at = NOW()
WHERE
    message_id = $1
    AND conversation_id IN (
        SELECT id
        FROM conversations
        WHERE
            (
                (
                    sqlc.narg('organization_id')::INT IS NULL
                    AND organization_id IS NULL
                    AND user_id = sqlc.narg('user_id')::TEXT
                )
                OR (
                    sqlc.narg('organization_id')::INT IS NOT NULL
                    AND organization_id = sqlc.narg('organization_id')
                )
            )
    );

-- name: CreateMessageSync :one
INSERT INTO messages (
    message_id, conversation_id, role, content, is_streaming, is_agent_status,
    elapsed_seconds, error, sources, tool_events, agent_statuses,
    sync_version, last_synced_at, device_id, is_deleted, created_at, vector_clock, trace, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15, $16, $17, NOW()
)
RETURNING
    id,
    message_id,
    conversation_id,
    role,
    content,
    is_streaming,
    is_agent_status,
    elapsed_seconds,
    created_at,
    error,
    sources,
    tool_events,
    agent_statuses,
    vector_clock,
    sync_version,
    last_synced_at,
    device_id,
    is_deleted,
    updated_at,
    COALESCE((TO_JSONB(messages) ->> 'rating')::INTEGER, 0) AS rating,
    TO_JSONB(messages) -> 'trace' AS trace;

-- name: GetMessageVersion :one
SELECT
    message_id,
    sync_version,
    vector_clock
FROM messages
WHERE message_id = $1;

-- name: GetMessageVersionScoped :one
SELECT
    m.message_id,
    m.sync_version,
    m.vector_clock
FROM messages AS m
JOIN conversations AS c ON m.conversation_id = c.id
WHERE
    m.message_id = sqlc.arg('message_id')
    AND (
        (
            sqlc.narg('organization_id')::INT IS NULL
            AND c.organization_id IS NULL
            AND c.user_id = sqlc.narg('user_id')::TEXT
        )
        OR (
            sqlc.narg('organization_id')::INT IS NOT NULL
            AND c.organization_id = sqlc.narg('organization_id')
        )
    );

-- name: GetMessagesAfterVersion :many
SELECT
    m.id,
    m.message_id,
    m.conversation_id,
    m.role,
    m.content,
    m.is_streaming,
    m.is_agent_status,
    m.elapsed_seconds,
    m.created_at,
    m.error,
    m.sources,
    m.tool_events,
    m.agent_statuses,
    m.vector_clock,
    m.sync_version,
    m.last_synced_at,
    m.device_id,
    m.is_deleted,
    m.updated_at,
    m.rating
FROM messages AS m
JOIN conversations AS c ON m.conversation_id = c.id
WHERE c.user_id = $1 AND c.organization_id IS NULL AND m.sync_version > $2
ORDER BY m.sync_version
LIMIT $3;

-- name: GetMessagesByOrgAfterVersion :many
SELECT
    m.id,
    m.message_id,
    m.conversation_id,
    m.role,
    m.content,
    m.is_streaming,
    m.is_agent_status,
    m.elapsed_seconds,
    m.created_at,
    m.error,
    m.sources,
    m.tool_events,
    m.agent_statuses,
    m.vector_clock,
    m.sync_version,
    m.last_synced_at,
    m.device_id,
    m.is_deleted,
    m.updated_at,
    m.rating
FROM messages AS m
JOIN conversations AS c ON m.conversation_id = c.id
WHERE c.organization_id = $1 AND m.sync_version > $2
ORDER BY m.sync_version
LIMIT $3;

-- name: CountMessagesByOrg :one
SELECT COUNT(*) FROM messages AS m
JOIN conversations AS c ON m.conversation_id = c.id
WHERE c.organization_id = $1 AND m.is_deleted = FALSE;

-- name: GetMessagesWithTraces :many
SELECT * FROM messages
WHERE rating >= $1 AND trace IS NOT NULL
ORDER BY created_at DESC
LIMIT $2;
