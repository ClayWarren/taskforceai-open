-- name: CreateSyncAuditLog :one
INSERT INTO sync_audit_logs (
    user_id,
    device_id,
    action,
    version_start,
    version_end,
    items_count,
    conflicts_count,
    duration_ms,
    success,
    error_message,
    details
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
) RETURNING
    id,
    timestamp,
    user_id,
    device_id,
    action,
    version_start,
    version_end,
    items_count,
    conflicts_count,
    duration_ms,
    success,
    error_message,
    details;
