-- name: GetSyncDevices :many
SELECT
    id,
    user_id,
    device_id,
    device_name,
    user_agent,
    last_seen_at,
    created_at,
    is_revoked
FROM sync_devices
WHERE user_id = $1 AND is_revoked = false
ORDER BY last_seen_at DESC;

-- name: RevokeSyncDevice :exec
UPDATE sync_devices
SET is_revoked = true
WHERE user_id = $1 AND device_id = $2;

-- name: IsSyncDeviceRevoked :one
SELECT EXISTS(
    SELECT 1
    FROM sync_devices
    WHERE user_id = $1 AND device_id = $2 AND is_revoked = true
)::BOOLEAN AS is_revoked;

-- name: UpsertSyncDevice :one
INSERT INTO sync_devices (user_id, device_id, device_name, user_agent, last_seen_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (user_id, device_id)
DO UPDATE
    SET
        last_seen_at = NOW(),
        device_name = COALESCE($3, sync_devices.device_name),
        user_agent = COALESCE($4, sync_devices.user_agent)
RETURNING
    id,
    user_id,
    device_id,
    device_name,
    user_agent,
    last_seen_at,
    created_at,
    is_revoked;
