UPDATE webhook_events
SET processed_at = CURRENT_TIMESTAMP
WHERE processed_at IS NULL;

ALTER TABLE webhook_events
ALTER COLUMN processed_at SET NOT NULL,
ALTER COLUMN processed_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE webhook_events
DROP COLUMN IF EXISTS claimed_at;
