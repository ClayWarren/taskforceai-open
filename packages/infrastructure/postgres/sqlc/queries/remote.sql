-- name: UpsertRemoteTarget :one
INSERT INTO remote_targets (
    user_id,
    device_id,
    device_name,
    allow_connections,
    keep_awake,
    last_seen_at,
    updated_at
)
VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
ON CONFLICT (user_id, device_id)
DO UPDATE SET
    device_name = EXCLUDED.device_name,
    allow_connections = EXCLUDED.allow_connections,
    keep_awake = EXCLUDED.keep_awake,
    last_seen_at = NOW(),
    updated_at = NOW()
RETURNING *;

-- name: GetRemoteTarget :one
SELECT *
FROM remote_targets
WHERE user_id = $1 AND device_id = $2;

-- name: TouchRemoteTarget :exec
UPDATE remote_targets
SET last_seen_at = NOW(), updated_at = NOW()
WHERE user_id = $1 AND device_id = $2 AND allow_connections = true;

-- name: UpsertRemoteConnection :one
INSERT INTO remote_connections (
    user_id,
    target_device_id,
    controller_device_id
)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, target_device_id, controller_device_id)
DO UPDATE SET
    revoked_at = NULL,
    last_used_at = NOW()
RETURNING *;

-- name: ListRemoteConnectionsForController :many
SELECT
    c.*,
    t.device_name AS target_name,
    t.allow_connections,
    t.keep_awake,
    t.last_seen_at AS target_last_seen_at
FROM remote_connections c
JOIN remote_targets t
  ON t.user_id = c.user_id AND t.device_id = c.target_device_id
WHERE c.user_id = $1
  AND c.controller_device_id = $2
  AND c.revoked_at IS NULL
ORDER BY c.last_used_at DESC;

-- name: ListRemoteControllersForTarget :many
SELECT
    c.*,
    d.device_name AS controller_name,
    d.user_agent AS controller_user_agent,
    d.last_seen_at AS controller_last_seen_at
FROM remote_connections c
LEFT JOIN sync_devices d
  ON d.user_id = c.user_id AND d.device_id = c.controller_device_id
WHERE c.user_id = $1
  AND c.target_device_id = $2
  AND c.revoked_at IS NULL
ORDER BY c.last_used_at DESC;

-- name: IsActiveRemoteConnection :one
SELECT EXISTS(
    SELECT 1
    FROM remote_connections c
    JOIN remote_targets t
      ON t.user_id = c.user_id AND t.device_id = c.target_device_id
    WHERE c.user_id = $1
      AND c.target_device_id = $2
      AND c.controller_device_id = $3
      AND c.revoked_at IS NULL
      AND t.allow_connections = true
      AND t.last_seen_at > NOW() - INTERVAL '15 seconds'
)::BOOLEAN AS active;

-- name: TouchRemoteConnection :exec
UPDATE remote_connections
SET last_used_at = NOW()
WHERE user_id = $1
  AND target_device_id = $2
  AND controller_device_id = $3
  AND revoked_at IS NULL;

-- name: RevokeRemoteConnection :exec
UPDATE remote_connections
SET revoked_at = NOW()
WHERE user_id = $1
  AND target_device_id = $2
  AND controller_device_id = $3
  AND revoked_at IS NULL;
