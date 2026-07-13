-- Remove trace and rating columns from messages table
ALTER TABLE messages DROP COLUMN IF EXISTS trace;
ALTER TABLE messages DROP COLUMN IF EXISTS rating;
