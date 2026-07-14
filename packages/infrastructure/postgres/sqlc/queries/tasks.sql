-- name: CreateTask :one
INSERT INTO tasks (task_id, prompt, user_id, model_id, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetTask :one
SELECT * FROM tasks
WHERE task_id = $1;

-- name: GetExecutionTrace :one
SELECT * FROM execution_traces
WHERE task_id = $1;

-- name: UpsertExecutionTrace :one
INSERT INTO execution_traces (id, task_id, user_id, goal, plan, steps, self_eval, artifacts)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (task_id) DO UPDATE
    SET
        user_id = COALESCE(excluded.user_id, execution_traces.user_id),
        goal = CASE
            WHEN excluded.goal <> '' THEN excluded.goal
            ELSE execution_traces.goal
        END,
        plan = excluded.plan,
        steps = excluded.steps,
        self_eval = excluded.self_eval,
        artifacts = excluded.artifacts
RETURNING *;
