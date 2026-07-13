-- name: GetAccountByProvider :one
SELECT * FROM accounts
WHERE provider = $1 AND provideraccountid = $2
LIMIT 1;

-- name: CreateAccount :one
INSERT INTO accounts (
    id, user_id, type, provider, provideraccountid,
    refresh_token, access_token, expires_at, token_type, scope, id_token, session_state
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
)
RETURNING *;

-- name: GetUserByAccount :one
SELECT u.* FROM users AS u
JOIN accounts AS a ON u.id = a.user_id
WHERE a.provider = $1 AND a.provideraccountid = $2;

-- name: GetAccountsByUserID :many
SELECT * FROM accounts
WHERE user_id = $1;

-- name: DeleteAccount :exec
DELETE FROM accounts
WHERE user_id = $1 AND provider = $2;
