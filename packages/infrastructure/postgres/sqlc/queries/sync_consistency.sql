-- name: GetConversationsCount :one
SELECT COUNT(*)::bigint
FROM conversations
WHERE
    user_id = $1
    AND organization_id IS NULL
    AND is_deleted = FALSE;

-- name: GetMessagesCount :one
SELECT COUNT(*)::bigint
FROM messages AS m
JOIN conversations AS c ON m.conversation_id = c.id
WHERE
    c.user_id = $1
    AND c.organization_id IS NULL
    AND m.is_deleted = FALSE;

-- name: GetUserSyncCounts :one
SELECT
    (
        SELECT COUNT(*)::bigint
        FROM conversations AS c
        WHERE
            c.user_id = $1
            AND c.organization_id IS NULL
            AND c.is_deleted = FALSE
    ) AS conversation_count,
    (
        SELECT COUNT(*)::bigint
        FROM messages AS m
        JOIN conversations AS c ON m.conversation_id = c.id
        WHERE
            c.user_id = $1
            AND c.organization_id IS NULL
            AND m.is_deleted = FALSE
    ) AS message_count;

-- name: GetOrgSyncCounts :one
SELECT
    (
        SELECT COUNT(*)::bigint
        FROM conversations AS c
        WHERE
            c.organization_id = $1
            AND c.is_deleted = FALSE
    ) AS conversation_count,
    (
        SELECT COUNT(*)::bigint
        FROM messages AS m
        JOIN conversations AS c ON m.conversation_id = c.id
        WHERE
            c.organization_id = $1
            AND m.is_deleted = FALSE
    ) AS message_count;
