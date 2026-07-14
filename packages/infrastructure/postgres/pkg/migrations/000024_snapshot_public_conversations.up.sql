ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS public_shared_at TIMESTAMP(3);

-- Preserve existing links while preventing messages created after deployment
-- from becoming public through an already-shared conversation.
UPDATE conversations
SET public_shared_at = CURRENT_TIMESTAMP
WHERE
    is_public = true
    AND public_shared_at IS null;
