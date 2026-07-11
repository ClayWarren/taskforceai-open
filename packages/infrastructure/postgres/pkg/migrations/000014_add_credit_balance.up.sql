-- Add credit balance and auto-recharge to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_balance DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_recharge_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_recharge_amount DECIMAL(10, 2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_recharge_threshold DECIMAL(10, 2);
