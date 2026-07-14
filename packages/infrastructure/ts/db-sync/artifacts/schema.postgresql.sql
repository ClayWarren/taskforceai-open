-- AUTO-GENERATED

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "last_message_preview" TEXT,
    "project_id" INTEGER,
    "sync_version" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" BIGINT NOT NULL DEFAULT 0,
    "device_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "message_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_streaming" BOOLEAN NOT NULL DEFAULT false,
    "is_agent_status" BOOLEAN NOT NULL DEFAULT false,
    "elapsed_seconds" DOUBLE PRECISION,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "error" TEXT,
    "sources" JSONB,
    "tool_events" JSONB,
    "agent_statuses" JSONB,
    "metadata" JSONB,
    "sync_version" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" BIGINT NOT NULL DEFAULT 0,
    "device_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_changes" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "pending_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metadata" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "metadata_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "pending_prompts" (
    "id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "conversation_id" TEXT,
    "created_at" BIGINT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "model_id" TEXT,

    CONSTRAINT "pending_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_queue" (
    "id" SERIAL NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "model_id" TEXT,
    "attachment_ids" TEXT,

    CONSTRAINT "prompt_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" SERIAL NOT NULL,
    "access_token" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "avatar_url" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "subscription_status" TEXT,
    "current_period_end" TEXT,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_timestamp" TEXT,
    "data" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_conversation_id_key" ON "conversations" ("conversation_id");

-- CreateIndex
CREATE INDEX "conversations_user_id_idx" ON "conversations" ("user_id");

-- CreateIndex
CREATE INDEX "conversations_updated_at_idx" ON "conversations" ("updated_at");

-- CreateIndex
CREATE INDEX "conversations_sync_version_idx" ON "conversations" ("sync_version");

-- CreateIndex
CREATE INDEX "conversations_last_synced_at_idx" ON "conversations" ("last_synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_message_id_key" ON "messages" ("message_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_idx" ON "messages" ("conversation_id");

-- CreateIndex
CREATE INDEX "messages_created_at_idx" ON "messages" ("created_at");

-- CreateIndex
CREATE INDEX "messages_sync_version_idx" ON "messages" ("sync_version");

-- CreateIndex
CREATE INDEX "pending_changes_created_at_idx" ON "pending_changes" ("created_at");

-- CreateIndex
CREATE INDEX "pending_prompts_created_at_idx" ON "pending_prompts" ("created_at");

-- CreateIndex
CREATE INDEX "prompt_queue_status_idx" ON "prompt_queue" ("status");

-- CreateIndex
CREATE INDEX "prompt_queue_created_at_idx" ON "prompt_queue" ("created_at");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" (
    "conversation_id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_prompts" ADD CONSTRAINT "pending_prompts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" (
    "conversation_id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_queue" ADD CONSTRAINT "prompt_queue_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" (
    "conversation_id"
) ON DELETE CASCADE ON UPDATE CASCADE;
