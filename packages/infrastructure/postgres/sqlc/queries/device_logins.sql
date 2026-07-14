-- name: GetDeviceLoginByCodes :one
SELECT * FROM device_logins
WHERE device_code = $1 AND user_code = $2 AND expires_at > NOW() AND status = 'PENDING'
LIMIT 1;

-- name: CreateDeviceLogin :one
INSERT INTO device_logins (
    device_code,
    user_code,
    status,
    poll_interval,
    expires_at
) VALUES (
    $1, $2, 'PENDING', $3, $4
)
RETURNING *;

-- name: GetDeviceLoginByUserCode :one
SELECT * FROM device_logins
WHERE user_code = $1
LIMIT 1;

-- name: GetDeviceLoginByDeviceCode :one
SELECT * FROM device_logins
WHERE device_code = $1
LIMIT 1;

-- name: UpdateDeviceLogin :exec
UPDATE device_logins
SET
    status = COALESCE(sqlc.narg('status'), status),
    user_id = COALESCE(sqlc.narg('user_id'), user_id),
    authorized_at = COALESCE(sqlc.narg('authorized_at'), authorized_at),
    completed_at = COALESCE(sqlc.narg('completed_at'), completed_at),
    last_polled_at = COALESCE(sqlc.narg('last_polled_at'), last_polled_at)
WHERE id = $1;

-- name: AuthorizeDeviceLoginIfPending :execrows
UPDATE device_logins
SET
    status = 'AUTHORIZED',
    user_id = $2,
    authorized_at = $3
WHERE
    id = $1
    AND status = 'PENDING'
    AND user_id IS NULL
    AND expires_at > NOW();

-- name: RecordDeviceLoginPollIfDue :execrows
UPDATE device_logins
SET last_polled_at = CAST(sqlc.arg(last_polled_at) AS TIMESTAMP)
WHERE
    id = $1
    AND status = 'PENDING'
    AND (
        last_polled_at IS NULL
        OR last_polled_at
        <= CAST(sqlc.arg(last_polled_at) AS TIMESTAMP)
        - (poll_interval * INTERVAL '1 second')
    );

-- name: CompleteDeviceLoginIfAuthorized :execrows
UPDATE device_logins
SET
    status = 'COMPLETED',
    completed_at = $2
WHERE
    id = $1
    AND status = 'AUTHORIZED'
    AND completed_at IS NULL;

-- name: GetActiveDeviceLoginsByUserID :many
SELECT * FROM device_logins
WHERE user_id = $1 AND status = 'COMPLETED' AND expires_at > NOW();

-- name: DeleteDeviceLoginByUserID :exec
DELETE FROM device_logins
WHERE user_id = $1;
