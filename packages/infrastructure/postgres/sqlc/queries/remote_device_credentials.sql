-- name: ClaimRemoteDeviceCredential :exec
INSERT INTO remote_device_credentials (user_id, device_id, credential_hash)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, device_id) DO NOTHING;

-- name: GetRemoteDeviceCredentialHash :one
SELECT credential_hash
FROM remote_device_credentials
WHERE user_id = $1 AND device_id = $2;
