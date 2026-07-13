-- name: GetAgent :one
SELECT * FROM agents
WHERE id = $1 LIMIT 1;

-- name: ListEnabledAgents :many
SELECT * FROM agents
WHERE autonomy_enabled = true;

-- name: ListAgentsByUserID :many
SELECT * FROM agents
WHERE user_id = $1;

-- name: UpdateAgentStatus :exec
UPDATE agents
SET status = $2, updated_at = CURRENT_TIMESTAMP
WHERE id = $1;

-- name: ListAgentsDueForPulse :many
SELECT * FROM agents
WHERE
    autonomy_enabled = true
    AND (next_run_at IS null OR next_run_at <= NOW());

-- name: ClaimAgentPulse :execrows
UPDATE agents
SET next_run_at = sqlc.arg(next_run_at), updated_at = CURRENT_TIMESTAMP
WHERE
    id = sqlc.arg(id)
    AND autonomy_enabled = true
    AND (next_run_at IS null OR next_run_at <= sqlc.arg(due_before));

-- name: UpdateAgentPulseState :exec
UPDATE agents
SET last_run_at = $2, next_run_at = $3, updated_at = CURRENT_TIMESTAMP
WHERE id = $1;

-- name: UpsertAgent :one
INSERT INTO agents (
    id, user_id, name, description, avatar, model_id, autonomy_enabled,
    timezone, active_start, active_end, active_days, check_interval, status, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO UPDATE
    SET
        name = excluded.name,
        description = excluded.description,
        avatar = excluded.avatar,
        model_id = excluded.model_id,
        autonomy_enabled = excluded.autonomy_enabled,
        timezone = excluded.timezone,
        active_start = excluded.active_start,
        active_end = excluded.active_end,
        active_days = excluded.active_days,
        check_interval = excluded.check_interval,
        updated_at = CURRENT_TIMESTAMP
    WHERE agents.user_id = excluded.user_id
RETURNING *;
