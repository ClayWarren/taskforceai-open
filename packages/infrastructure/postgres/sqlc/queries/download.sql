-- name: RecordDownload :exec
INSERT INTO downloads (
    product,
    platform,
    version,
    user_agent,
    ip_address_hash,
    referrer,
    timestamp
) VALUES (
    $1, $2, $3, $4, $5, $6, NOW()
);
