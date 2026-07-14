-- name: AcquireSyncPushResultLock :exec
SELECT PG_ADVISORY_XACT_LOCK(
    HASHTEXTEXTENDED(sqlc.arg('user_id') || ':' || sqlc.arg('idempotency_key'), 0)
);

-- name: GetSyncPushResult :one
SELECT response
FROM sync_push_results
WHERE
    user_id = $1
    AND idempotency_key = $2
    AND expires_at > NOW();

-- name: SaveSyncPushResult :exec
WITH expired_results AS (
    SELECT
        user_id,
        idempotency_key
    FROM sync_push_results
    WHERE expires_at <= NOW()
    ORDER BY expires_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
),

deleted_expired_results AS (
    DELETE FROM sync_push_results AS results
    USING expired_results
    WHERE
        results.user_id = expired_results.user_id
        AND results.idempotency_key = expired_results.idempotency_key
)

INSERT INTO sync_push_results (user_id, idempotency_key, response)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, idempotency_key)
DO UPDATE SET
    response = excluded.response,
    created_at = NOW(),
    expires_at = NOW() + INTERVAL '7 days'
WHERE sync_push_results.expires_at <= NOW();
