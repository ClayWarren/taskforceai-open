-- name: GetAPIKeyWithUserByHash :one
SELECT
    k.id,
    k.user_id,
    k.key_hash,
    k.tier,
    k.rate_limit,
    k.monthly_quota,
    k.revoked_at,
    u.disabled AS user_disabled,
    u.plan AS user_plan,
    u.api_tier AS user_api_tier,
    u.api_requests_limit AS user_api_requests_limit,
    u.api_requests_used AS user_api_requests_used,
    u.api_current_period_end AS user_api_current_period_end
FROM developer_api_keys AS k
JOIN users AS u ON k.user_id = u.id
WHERE k.key_hash = $1 AND k.revoked_at IS NULL;

-- name: GetAPIKeysByUser :many
SELECT * FROM developer_api_keys
WHERE user_id = $1
ORDER BY created_at DESC;

-- name: CreateAPIKey :one
INSERT INTO developer_api_keys (user_id, key_hash, display_key, name, tier, rate_limit, monthly_quota, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
RETURNING *;

-- name: RevokeAPIKey :exec
UPDATE developer_api_keys SET revoked_at = NOW()
WHERE id = $1;

-- name: UpdateAPIKeyLastUsed :exec
UPDATE developer_api_keys SET last_used_at = NOW()
WHERE id = $1;

-- name: GetAPIUsageInWindow :one
SELECT COALESCE(SUM(count), 0)::int AS total_count
FROM developer_api_usage
WHERE api_key_id = $1 AND window_start >= $2 AND window_start < $3;

-- name: CountActiveKeysForUser :one
SELECT COUNT(*)::int FROM developer_api_keys
WHERE user_id = $1 AND revoked_at IS NULL;

-- name: GetAPIKeyByIDAndUser :one
SELECT * FROM developer_api_keys
WHERE id = $1 AND user_id = $2;

-- name: GetAPIUsageSince :many
SELECT * FROM developer_api_usage
WHERE api_key_id = ANY($1::int []) AND window_start >= $2
ORDER BY window_start;
