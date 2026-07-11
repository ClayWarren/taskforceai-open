ALTER TABLE "conversations"
ADD COLUMN IF NOT EXISTS "public_shared_at" TIMESTAMP(3);

UPDATE "conversations"
SET "public_shared_at" = CURRENT_TIMESTAMP
WHERE
    "is_public" = true
    AND "public_shared_at" IS null;

DROP INDEX IF EXISTS "execution_traces_task_id_idx";
