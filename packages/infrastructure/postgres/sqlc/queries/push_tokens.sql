-- name: UpsertPushToken :exec
INSERT INTO push_notification_tokens (
    token,
    platform,
    device_id,
    app_version,
    user_id,
    last_registered_at,
    updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, NOW()
)
ON CONFLICT (token) DO UPDATE SET
    platform = excluded.platform,
    device_id = excluded.device_id,
    app_version = excluded.app_version,
    user_id = excluded.user_id,
    last_registered_at = excluded.last_registered_at,
    updated_at = NOW();

-- name: DeletePushToken :execrows
DELETE FROM push_notification_tokens
WHERE user_id = $1 AND token = $2;
