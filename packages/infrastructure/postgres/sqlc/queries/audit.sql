-- name: CreateAuditLog :one
INSERT INTO audit_logs (
    user_id, organization_id, action, resource, resource_id, ip_address, user_agent, details, success, error_message
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetAuditLogsByUser :many
SELECT * FROM audit_logs
WHERE user_id = $1
ORDER BY timestamp DESC
LIMIT $2;

-- name: GetAuditLogsByOrganization :many
SELECT * FROM audit_logs
WHERE organization_id = $1
ORDER BY timestamp DESC
LIMIT $2;

-- name: GetAuditLogsByResourceAndID :many
SELECT * FROM audit_logs
WHERE resource = $1 AND resource_id = $2
ORDER BY timestamp DESC
LIMIT $3;

-- name: GetFailedLoginAttempts :many
SELECT * FROM audit_logs
WHERE action = 'LOGIN' AND success = false AND timestamp > NOW() - ($1 * INTERVAL '1 hour')
ORDER BY timestamp DESC
LIMIT $2;

-- name: GetAuditLogsForPeriod :many
SELECT * FROM audit_logs
WHERE timestamp >= $1 AND timestamp <= $2 AND action = ANY($3::TEXT [])
ORDER BY timestamp DESC;

-- name: GetAuditLogsFiltered :many
SELECT * FROM audit_logs
WHERE
    (sqlc.narg('user_id')::TEXT IS null OR user_id = sqlc.narg('user_id')::TEXT)
    AND (sqlc.narg('action')::TEXT IS null OR action = sqlc.narg('action')::TEXT)
    AND (sqlc.narg('resource')::TEXT IS null OR resource = sqlc.narg('resource')::TEXT)
    AND (
        sqlc.narg('organization_id')::INT IS null
        OR organization_id = sqlc.narg('organization_id')::INT
    )
    AND (
        sqlc.narg('start_date')::TIMESTAMP IS null
        OR timestamp >= sqlc.narg('start_date')::TIMESTAMP
    )
    AND (
        sqlc.narg('end_date')::TIMESTAMP IS null
        OR timestamp <= sqlc.narg('end_date')::TIMESTAMP
    )
ORDER BY timestamp DESC
LIMIT sqlc.arg('limit')::INT OFFSET sqlc.arg('offset')::INT;

-- name: CountAuditLogsFiltered :one
SELECT COUNT(*)::BIGINT FROM audit_logs
WHERE
    (sqlc.narg('user_id')::TEXT IS null OR user_id = sqlc.narg('user_id')::TEXT)
    AND (sqlc.narg('action')::TEXT IS null OR action = sqlc.narg('action')::TEXT)
    AND (sqlc.narg('resource')::TEXT IS null OR resource = sqlc.narg('resource')::TEXT)
    AND (
        sqlc.narg('organization_id')::INT IS null
        OR organization_id = sqlc.narg('organization_id')::INT
    )
    AND (
        sqlc.narg('start_date')::TIMESTAMP IS null
        OR timestamp >= sqlc.narg('start_date')::TIMESTAMP
    )
    AND (
        sqlc.narg('end_date')::TIMESTAMP IS null
        OR timestamp <= sqlc.narg('end_date')::TIMESTAMP
    );
