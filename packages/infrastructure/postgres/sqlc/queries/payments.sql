-- name: RecordWebhookEvent :execrows
INSERT INTO webhook_events (stripe_event_id, type, claim_token, claimed_at, processed_at)
VALUES (
    sqlc.arg(stripe_event_id),
    sqlc.arg(type),
    sqlc.arg(claim_token),
    CURRENT_TIMESTAMP,
    NULL
)
ON CONFLICT (stripe_event_id) DO UPDATE
    SET
        type = excluded.type,
        claim_token = excluded.claim_token,
        claimed_at = CURRENT_TIMESTAMP
    WHERE
    webhook_events.processed_at IS NULL
    AND webhook_events.claimed_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes';

-- name: CompleteWebhookEvent :execrows
UPDATE webhook_events
SET processed_at = CURRENT_TIMESTAMP
WHERE
    stripe_event_id = sqlc.arg(stripe_event_id)
    AND claim_token = sqlc.arg(claim_token)
    AND processed_at IS NULL;

-- name: DeleteWebhookEvent :execrows
DELETE FROM webhook_events
WHERE
    stripe_event_id = sqlc.arg(stripe_event_id)
    AND claim_token = sqlc.arg(claim_token)
    AND processed_at IS NULL;

-- name: WebhookEventExists :one
SELECT EXISTS(
    SELECT 1 FROM webhook_events
    WHERE stripe_event_id = $1 AND processed_at IS NOT NULL
);

-- name: GetUserByCustomerID :one
SELECT * FROM users
WHERE customer_id = $1;

-- name: GetUserByRevenueCatAppUserID :one
SELECT * FROM users
WHERE revenuecat_app_user_id = $1
LIMIT 1;

-- name: UpdateUserCustomerID :exec
UPDATE users SET customer_id = $2
WHERE id = $1;

-- name: UpdateUserSubscriptionStatus :exec
UPDATE users SET
    subscription_status = COALESCE(sqlc.narg('subscription_status'), subscription_status),
    cancel_at_period_end = COALESCE(sqlc.narg('cancel_at_period_end'), cancel_at_period_end),
    current_period_start = COALESCE(sqlc.narg('current_period_start'), current_period_start),
    current_period_end = COALESCE(sqlc.narg('current_period_end'), current_period_end)
WHERE id = $1;

-- name: UpdateUserWebhookFull :exec
UPDATE users SET
    subscription_id = COALESCE(sqlc.narg('subscription_id'), subscription_id),
    subscription_status = COALESCE(sqlc.narg('subscription_status'), subscription_status),
    subscription_source = COALESCE(sqlc.narg('subscription_source'), subscription_source),
    current_period_start = COALESCE(sqlc.narg('current_period_start'), current_period_start),
    current_period_end = COALESCE(sqlc.narg('current_period_end'), current_period_end),
    cancel_at_period_end = COALESCE(sqlc.narg('cancel_at_period_end'), cancel_at_period_end),
    stripe_subscription_event_created_at = COALESCE(sqlc.narg('stripe_subscription_event_created_at'), stripe_subscription_event_created_at),
    customer_id = COALESCE(sqlc.narg('customer_id'), customer_id),
    plan = COALESCE(sqlc.narg('plan'), plan),
    price_id = COALESCE(sqlc.narg('price_id'), price_id),
    payment_method_brand = COALESCE(sqlc.narg('payment_method_brand'), payment_method_brand),
    payment_method_last4 = COALESCE(sqlc.narg('payment_method_last4'), payment_method_last4)
WHERE
    id = $1
    AND (
        sqlc.narg('stripe_subscription_event_created_at') IS NULL
        OR stripe_subscription_event_created_at IS NULL
        OR stripe_subscription_event_created_at < sqlc.narg('stripe_subscription_event_created_at')
    );

-- name: ResetUserWebhookSubscription :exec
UPDATE users SET
    subscription_id = NULL,
    subscription_status = NULL,
    subscription_source = NULL,
    current_period_start = NULL,
    current_period_end = NULL,
    cancel_at_period_end = FALSE,
    stripe_subscription_event_created_at = COALESCE(sqlc.narg('stripe_subscription_event_created_at'), stripe_subscription_event_created_at),
    plan = COALESCE(sqlc.narg('plan'), plan),
    price_id = NULL,
    payment_method_brand = NULL,
    payment_method_last4 = NULL,
    mobile_product_id = NULL,
    mobile_original_transaction_id = NULL
WHERE
    id = $1
    -- Deletes win timestamp ties; normal updates keep the strict guard above.
    AND (
        sqlc.narg('stripe_subscription_event_created_at') IS NULL
        OR stripe_subscription_event_created_at IS NULL
        OR stripe_subscription_event_created_at <= sqlc.narg('stripe_subscription_event_created_at')
    );

-- name: UpdateUserMobileSubscription :exec
UPDATE users SET
    plan = COALESCE(sqlc.narg('plan'), plan),
    subscription_id = COALESCE(sqlc.narg('subscription_id'), subscription_id),
    subscription_status = COALESCE(sqlc.narg('subscription_status'), subscription_status),
    subscription_source = COALESCE(sqlc.narg('subscription_source'), subscription_source),
    current_period_start = COALESCE(sqlc.narg('current_period_start'), current_period_start),
    current_period_end = COALESCE(sqlc.narg('current_period_end'), current_period_end),
    cancel_at_period_end = COALESCE(sqlc.narg('cancel_at_period_end'), cancel_at_period_end),
    price_id = COALESCE(sqlc.narg('price_id'), price_id),
    revenuecat_app_user_id = COALESCE(sqlc.narg('revenuecat_app_user_id'), revenuecat_app_user_id),
    mobile_product_id = COALESCE(sqlc.narg('mobile_product_id'), mobile_product_id),
    mobile_original_transaction_id = COALESCE(sqlc.narg('mobile_original_transaction_id'), mobile_original_transaction_id)
WHERE id = $1;

-- name: ResetUserMobileSubscription :exec
UPDATE users SET
    plan = COALESCE(sqlc.narg('plan'), plan),
    subscription_id = NULL,
    subscription_status = NULL,
    subscription_source = NULL,
    current_period_start = NULL,
    current_period_end = NULL,
    cancel_at_period_end = FALSE,
    price_id = NULL,
    mobile_product_id = NULL,
    mobile_original_transaction_id = NULL
WHERE id = $1;
