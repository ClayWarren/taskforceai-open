-- name: CountMessagesSince :one
SELECT COUNT(*)::bigint AS count
FROM messages
WHERE created_at >= $1 AND is_deleted = false;

-- name: GetConversationAggregateSince :one
SELECT
    COUNT(*)::bigint AS count,
    COALESCE(AVG(execution_time), 0)::double precision AS avg_execution_time,
    COALESCE(MAX(execution_time), 0)::double precision AS max_execution_time,
    COALESCE(SUM(execution_time), 0)::bigint AS sum_execution_time
FROM conversations
WHERE timestamp >= $1 AND is_deleted = false;

-- name: GetModelUsageSince :many
SELECT
    COUNT(*)::bigint AS count,
    COALESCE(model, 'unknown') AS model
FROM conversations
WHERE timestamp >= $1 AND is_deleted = false
GROUP BY COALESCE(model, 'unknown')
ORDER BY count DESC
LIMIT $2;

-- name: GetSlowestConversationsSince :many
SELECT
    id,
    execution_time,
    user_id,
    timestamp
FROM conversations
WHERE timestamp >= $1 AND execution_time IS NOT null AND is_deleted = false
ORDER BY execution_time DESC
LIMIT $2;

-- name: CountInProgressConversationsSince :one
SELECT COUNT(DISTINCT conversation_id)::bigint AS count
FROM messages
WHERE is_streaming = true AND is_deleted = false AND created_at >= $1;

-- name: GetPlanCounts :many
SELECT
    plan,
    COUNT(*)::bigint AS count
FROM users
GROUP BY plan
ORDER BY plan;

-- name: GetTopUsersByMessageCount :many
SELECT
    id,
    email,
    plan,
    message_count
FROM users
ORDER BY message_count DESC, id ASC
LIMIT $1;

-- name: GetTokenAggregateSince :one
SELECT
    COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
    COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
    COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
    COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros
FROM token_usage
WHERE created_at >= $1;

-- name: GetTokenAggregateAllTime :one
SELECT
    COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
    COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
    COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
    COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros
FROM token_usage;

-- name: GetTokensByModelSince :many
SELECT
    COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
    COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros,
    COALESCE(model, 'unknown') AS model
FROM token_usage
WHERE created_at >= $1
GROUP BY COALESCE(model, 'unknown')
ORDER BY total_tokens DESC NULLS LAST
LIMIT $2;

-- name: GetToolUsageSince :many
SELECT
    tool_name,
    COUNT(*)::bigint AS count,
    COALESCE(SUM(duration_ms), 0)::bigint AS sum_duration_ms,
    COALESCE(AVG(duration_ms), 0)::double precision AS avg_duration_ms
FROM tool_usage
WHERE created_at >= $1
GROUP BY tool_name
ORDER BY count DESC, tool_name ASC;

-- name: GetToolSuccessSince :many
SELECT
    tool_name,
    success,
    COUNT(*)::bigint AS count
FROM tool_usage
WHERE created_at >= $1
GROUP BY tool_name, success
ORDER BY tool_name ASC;

-- name: ListOrganizationsForAdmin :many
SELECT
    o.id,
    o.name,
    o.slug,
    o.plan,
    o.workos_organization_id,
    o.created_at,
    COUNT(DISTINCT m.user_id)::bigint AS member_count,
    CASE
        WHEN o.settings ? 'rpmQuota' AND (o.settings ->> 'rpmQuota') ~ '^[0-9]+$'
            THEN (o.settings ->> 'rpmQuota')::int
        ELSE 50
    END AS rpm_quota,
    CASE
        WHEN o.settings ? 'tokensQuotaMonth' AND (o.settings ->> 'tokensQuotaMonth') ~ '^[0-9]+$'
            THEN (o.settings ->> 'tokensQuotaMonth')::bigint
        ELSE 5000000::bigint
    END AS tokens_quota_month
FROM organizations AS o
LEFT JOIN memberships AS m ON o.id = m.organization_id
GROUP BY o.id
ORDER BY o.created_at DESC;

-- name: UpdateOrganizationAdmin :one
UPDATE organizations
SET
    plan = sqlc.arg(plan),
    workos_organization_id = NULLIF(sqlc.arg(workos_org_id)::text, ''),
    settings = JSONB_SET(
        JSONB_SET(
            COALESCE(settings, '{}'::jsonb),
            '{rpmQuota}',
            TO_JSONB(sqlc.arg(rpm_quota)::int),
            true
        ),
        '{tokensQuotaMonth}',
        TO_JSONB(sqlc.arg(tokens_quota_month)::bigint),
        true
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: CreateServiceIncident :one
INSERT INTO service_incidents (service_id, status, message)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListServiceIncidents :many
SELECT * FROM service_incidents
ORDER BY started_at DESC
LIMIT $1;
