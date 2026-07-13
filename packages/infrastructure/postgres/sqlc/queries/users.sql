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
WHERE email = $1;

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
DELETE FROM users
WHERE id = $1;

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
        sqlc.arg(search)::text = ''
        OR email ILIKE '%' || sqlc.arg(search)::text || '%'
        OR COALESCE(full_name, '') ILIKE '%' || sqlc.arg(search)::text || '%'
    )
    AND (sqlc.arg(plan)::text = '' OR plan = sqlc.arg(plan)::text)
ORDER BY id
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: CountUsersForAdmin :one
SELECT COUNT(*) FROM users
WHERE
    (
        sqlc.arg(search)::text = ''
        OR email ILIKE '%' || sqlc.arg(search)::text || '%'
        OR COALESCE(full_name, '') ILIKE '%' || sqlc.arg(search)::text || '%'
    )
    AND (sqlc.arg(plan)::text = '' OR plan = sqlc.arg(plan)::text);

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
WHERE id = $1 RETURNING *;

-- name: EnableUserMFA :one
UPDATE users SET
    mfa_enabled = true,
    mfa_verified_at = NOW()
WHERE id = $1 RETURNING *;

-- name: DisableUserMFA :one
UPDATE users SET
    mfa_enabled = false,
    mfa_totp_secret = null,
    mfa_verified_at = null
WHERE id = $1 RETURNING *;

-- name: GetUserStats :one
SELECT
    COUNT(*) AS total_users,
    COUNT(*) FILTER (WHERE last_message_timestamp > NOW() - interval '24 hours') AS active_users_24h,
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
