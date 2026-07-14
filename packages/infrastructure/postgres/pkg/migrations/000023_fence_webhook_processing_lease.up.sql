ALTER TABLE webhook_events
ADD COLUMN IF NOT EXISTS claim_token TEXT;
