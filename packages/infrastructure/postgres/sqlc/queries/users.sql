-- name: GetUserByID :one
SELECT * FROM users
WHERE id = $1;

-- name: GetUserRefreshStatus :one
SELECT
    id,
    disabled
FROM users
WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = $1 OR LOWER(email) = LOWER($1)
ORDER BY (email = $1) DESC, id
LIMIT 1;

-- name: UpdateUserEmail :one
UPDATE users SET email = $2
WHERE id = $1
RETURNING *;

-- name: CreateUser :one
INSERT INTO users (email, full_name, plan)
VALUES ($1, $2, $3)
ON CONFLICT (email) DO UPDATE SET full_name = COALESCE(users.full_name, excluded.full_name)
RETURNING *;

-- name: UpdateUserPlan :exec
UPDATE users SET
    plan = $2, subscription_id = $3, subscription_status = $4,
    current_period_start = $5, current_period_end = $6, cancel_at_period_end = $7
WHERE id = $1;

-- name: DeleteUser :exec
WITH target_user AS (
    SELECT
        users.id,
        users.id::TEXT AS text_id
    FROM users
    WHERE users.id = $1
),

deleted_conversations AS (
    DELETE FROM conversations
    USING target_user
    WHERE conversations.user_id = target_user.text_id
),

deleted_rate_limits AS (
    DELETE FROM rate_limits
    USING target_user
    WHERE rate_limits.user_id = target_user.text_id
),

deleted_tasks AS (
    DELETE FROM tasks
    USING target_user
    WHERE tasks.user_id = target_user.text_id
),

deleted_audit_logs AS (
    DELETE FROM audit_logs
    USING target_user
    WHERE audit_logs.user_id = target_user.text_id
),

deleted_sync_audit_logs AS (
    DELETE FROM sync_audit_logs
    USING target_user
    WHERE sync_audit_logs.user_id = target_user.text_id
),

deleted_sync_devices AS (
    DELETE FROM sync_devices
    USING target_user
    WHERE sync_devices.user_id = target_user.text_id
),

deleted_sync_push_results AS (
    DELETE FROM sync_push_results
    USING target_user
    WHERE sync_push_results.user_id = target_user.text_id
),

deleted_remote_targets AS (
    DELETE FROM remote_targets
    USING target_user
    WHERE remote_targets.user_id = target_user.text_id
),

deleted_remote_connections AS (
    DELETE FROM remote_connections
    USING target_user
    WHERE remote_connections.user_id = target_user.text_id
),

deleted_remote_device_credentials AS (
    DELETE FROM remote_device_credentials
    USING target_user
    WHERE remote_device_credentials.user_id = target_user.text_id
),

deleted_token_usage AS (
    DELETE FROM token_usage
    USING target_user
    WHERE token_usage.user_id = target_user.text_id
),

deleted_tool_usage AS (
    DELETE FROM tool_usage
    USING target_user
    WHERE tool_usage.user_id = target_user.text_id
),

deleted_usage_events AS (
    DELETE FROM usage_events
    USING target_user
    WHERE usage_events.user_id = target_user.text_id
),

deleted_execution_traces AS (
    DELETE FROM execution_traces
    USING target_user
    WHERE execution_traces.user_id = target_user.id
)

DELETE FROM users
USING target_user
WHERE users.id = target_user.id;

-- name: ListUsers :many
SELECT * FROM users
ORDER BY id
LIMIT $1 OFFSET $2;

-- name: CountUsers :one
SELECT COUNT(*) FROM users;

-- name: ListUsersForAdmin :many
SELECT * FROM users
WHERE
    (
        sqlc.arg(search)::TEXT = ''
        OR email ILIKE '%' || sqlc.arg(search)::TEXT || '%'
        OR COALESCE(full_name, '') ILIKE '%' || sqlc.arg(search)::TEXT || '%'
    )
    AND (sqlc.arg(plan)::TEXT = '' OR plan = sqlc.arg(plan)::TEXT)
ORDER BY id
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: CountUsersForAdmin :one
SELECT COUNT(*) FROM users
WHERE
    (
        sqlc.arg(search)::TEXT = ''
        OR email ILIKE '%' || sqlc.arg(search)::TEXT || '%'
        OR COALESCE(full_name, '') ILIKE '%' || sqlc.arg(search)::TEXT || '%'
    )
    AND (sqlc.arg(plan)::TEXT = '' OR plan = sqlc.arg(plan)::TEXT);

-- name: UpdateUserAdminByEmail :one
UPDATE users SET is_admin = $2
WHERE email = $1 RETURNING *;

-- name: UpdateUserAdminByID :one
UPDATE users SET is_admin = $2
WHERE id = $1 RETURNING *;

-- name: UpdateUserPlanByEmail :one
UPDATE users SET plan = $2
WHERE email = $1 RETURNING *;

-- name: UpdateUserTheme :one
UPDATE users SET theme_preference = $2
WHERE id = $1 RETURNING *;

-- name: UpdateUserFullName :one
UPDATE users SET full_name = $2
WHERE id = $1 RETURNING *;

-- name: UpdateUserMemoryEnabled :one
UPDATE users SET memory_enabled = $2
WHERE id = $1 RETURNING *;

-- name: UpdateUserWebSearchEnabled :one
UPDATE users SET web_search_enabled = $2
WHERE id = $1 RETURNING *;

-- name: UpdateUserCodeExecutionEnabled :one
UPDATE users SET code_execution_enabled = $2
WHERE id = $1 RETURNING *;

-- name: UpdateUserNotificationsEnabled :one
UPDATE users SET notifications_enabled = $2
WHERE id = $1 RETURNING *;

-- name: UpdateUserQuickModeEnabled :one
UPDATE users SET quick_mode_enabled = $2
WHERE id = $1 RETURNING *;

-- name: UpdateUserTrustLayerEnabled :one
UPDATE users SET trust_layer_enabled = $2
WHERE id = $1 RETURNING *;

-- name: GetUserMFASettings :one
SELECT
    id,
    email,
    full_name,
    mfa_enabled,
    mfa_totp_secret,
    mfa_verified_at
FROM users
WHERE id = $1;

-- name: StoreUserMFASetup :one
UPDATE users SET
    mfa_enabled = false,
    mfa_totp_secret = $2,
    mfa_verified_at = null
WHERE id = $1 AND mfa_enabled = false RETURNING *;

-- name: EnableUserMFAIfSecretMatches :one
UPDATE users SET
    mfa_enabled = true,
    mfa_verified_at = NOW()
WHERE id = $1 AND mfa_enabled = false AND mfa_totp_secret = $2
RETURNING *;

-- name: DisableUserMFAIfSecretMatches :one
UPDATE users SET
    mfa_enabled = false,
    mfa_totp_secret = null,
    mfa_verified_at = null
WHERE id = $1 AND mfa_enabled = true AND mfa_totp_secret = $2
RETURNING *;

-- name: GetUserStats :one
SELECT
    COUNT(*) AS total_users,
    COUNT(*) FILTER (WHERE last_message_timestamp > NOW() - INTERVAL '24 hours') AS active_users_24h,
    COUNT(*) FILTER (WHERE plan = 'free') AS free_users,
    COUNT(*) FILTER (WHERE plan = 'pro') AS pro_users,
    COUNT(*) FILTER (WHERE plan = 'super') AS super_users
FROM users;

-- name: UpdateUserAutoRecharge :exec
UPDATE users SET
    auto_recharge_enabled = $2,
    auto_recharge_amount = $3,
    auto_recharge_threshold = $4
WHERE id = $1;
