-- Add trace and rating columns to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS rating INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS trace JSONB;
