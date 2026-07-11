-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('STRIPE', 'APP_STORE', 'PLAY_STORE');

-- CreateEnum
CREATE TYPE "DeveloperApiTier" AS ENUM ('STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM (
    'DOCUMENT',
    'SPREADSHEET',
    'CHART',
    'IMAGE',
    'VIDEO',
    'SITE',
    'DASHBOARD',
    'ARCHIVE',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "ArtifactStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "ArtifactVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION', 'PUBLIC_LINK');

-- CreateEnum
CREATE TYPE "ArtifactShareScope" AS ENUM ('ORGANIZATION', 'PUBLIC_LINK', 'USER');

-- CreateEnum
CREATE TYPE "ArtifactPermission" AS ENUM ('VIEW', 'COMMENT', 'EDIT');

-- CreateEnum
CREATE TYPE "device_loginsStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'COMPLETED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "theme_preference" TEXT NOT NULL DEFAULT 'dark',
    "memory_enabled" BOOLEAN NOT NULL DEFAULT true,
    "web_search_enabled" BOOLEAN NOT NULL DEFAULT true,
    "code_execution_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "trust_layer_enabled" BOOLEAN NOT NULL DEFAULT false,
    "quick_mode_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_totp_secret" TEXT,
    "mfa_verified_at" TIMESTAMP(3),
    "plan" TEXT NOT NULL DEFAULT 'free',
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_timestamp" TIMESTAMP(3),
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "subscription_id" TEXT,
    "subscription_status" TEXT,
    "subscription_source" "SubscriptionSource",
    "price_id" TEXT,
    "payment_method_brand" TEXT,
    "payment_method_last4" TEXT,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "stripe_subscription_event_created_at" TIMESTAMP(3),
    "customer_id" TEXT,
    "revenuecat_app_user_id" TEXT,
    "mobile_original_transaction_id" TEXT,
    "mobile_product_id" TEXT,
    "api_subscription_id" TEXT,
    "api_subscription_status" TEXT,
    "api_tier" "DeveloperApiTier" NOT NULL DEFAULT 'STARTER',
    "api_requests_used" INTEGER NOT NULL DEFAULT 0,
    "api_requests_limit" INTEGER NOT NULL DEFAULT 100,
    "api_current_period_start" TIMESTAMP(3),
    "api_current_period_end" TIMESTAMP(3),
    "requests_limit" INTEGER,
    "reset_date" TIMESTAMP(3),
    "credit_balance" DECIMAL(10, 2) NOT NULL DEFAULT 0,
    "auto_recharge_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_recharge_amount" DECIMAL(10, 2),
    "auto_recharge_threshold" DECIMAL(10, 2),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_plan_check" CHECK ("plan" IN ('free', 'pro', 'super', 'admin'))
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "subscription_id" TEXT,
    "subscription_status" TEXT,
    "customer_id" TEXT,
    "workos_organization_id" TEXT,
    "no_training" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organizations_plan_check" CHECK ("plan" IN ('free', 'pro', 'super', 'admin'))
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "organization_id" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "custom_instructions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "organization_id" INTEGER,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'fact',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provideraccountid" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS sync_version_seq;

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "organization_id" INTEGER,
    "user_input" TEXT NOT NULL,
    "result" TEXT,
    "execution_time" DOUBLE PRECISION,
    "model" TEXT,
    "agent_count" INTEGER NOT NULL DEFAULT 4,
    "project_id" INTEGER,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "share_id" TEXT,
    "public_shared_at" TIMESTAMP(3),
    "vector_clock" JSONB,
    "sync_version" INTEGER NOT NULL DEFAULT NEXTVAL('sync_version_seq'),
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "message_id" TEXT NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_streaming" BOOLEAN NOT NULL DEFAULT false,
    "is_agent_status" BOOLEAN NOT NULL DEFAULT false,
    "elapsed_seconds" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "sources" JSONB,
    "tool_events" JSONB,
    "agent_statuses" JSONB,
    "vector_clock" JSONB,
    "sync_version" INTEGER NOT NULL DEFAULT NEXTVAL('sync_version_seq'),
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "trace" JSONB,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metric_name" TEXT NOT NULL,
    "metric_value" DOUBLE PRECISION,
    "details" TEXT,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "downloads" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "product" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address_hash" TEXT,
    "country" TEXT,
    "referrer" TEXT,

    CONSTRAINT "downloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_notification_tokens" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "device_id" TEXT,
    "app_version" TEXT,
    "last_registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" INTEGER,

    CONSTRAINT "push_notification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_api_keys" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "key_hash" TEXT NOT NULL,
    "display_key" TEXT NOT NULL,
    "name" TEXT,
    "tier" "DeveloperApiTier" NOT NULL DEFAULT 'STARTER',
    "rate_limit" INTEGER NOT NULL DEFAULT 10,
    "monthly_quota" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "developer_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_api_usage" (
    "id" SERIAL NOT NULL,
    "api_key_id" INTEGER NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "endpoint" TEXT,
    "status_code" INTEGER,
    "response_time" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "developer_api_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_storage_quotas" (
    "user_id" INTEGER NOT NULL,
    "quota_bytes" BIGINT NOT NULL DEFAULT 42949672960,
    "used_bytes" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_storage_quotas_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_storage_quotas_quota_nonnegative" CHECK ("quota_bytes" >= 0),
    CONSTRAINT "user_storage_quotas_used_nonnegative" CHECK ("used_bytes" >= 0),
    CONSTRAINT "user_storage_quotas_used_lte_quota" CHECK ("used_bytes" <= "quota_bytes")
);

-- CreateTable
CREATE TABLE "developer_files" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "organization_id" INTEGER,
    "filename" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'assistants',
    "mime_type" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "blob_url" TEXT NOT NULL,
    "blob_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "developer_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "developer_files_bytes_nonnegative" CHECK ("bytes" >= 0)
);

-- CreateTable
CREATE TABLE "developer_file_upload_reservations" (
    "file_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "blob_path" TEXT NOT NULL,
    "reserved_bytes" BIGINT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_file_upload_reservations_pkey" PRIMARY KEY ("file_id"),
    CONSTRAINT "developer_file_upload_reservations_reserved_bytes_positive" CHECK ("reserved_bytes" > 0)
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "organization_id" INTEGER,
    "owner_user_id" INTEGER NOT NULL,
    "conversation_id" INTEGER,
    "message_id" TEXT,
    "task_id" TEXT,
    "type" "ArtifactType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ArtifactStatus" NOT NULL DEFAULT 'READY',
    "visibility" "ArtifactVisibility" NOT NULL DEFAULT 'PRIVATE',
    "current_version_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_versions" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "file_id" TEXT,
    "mime_type" TEXT,
    "filename" TEXT,
    "bytes" BIGINT,
    "render_metadata" JSONB,
    "source_tool_name" TEXT,
    "source_prompt" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "artifact_versions_bytes_nonnegative" CHECK ("bytes" IS null OR "bytes" >= 0),
    CONSTRAINT "artifact_versions_version_positive" CHECK ("version" > 0)
);

-- CreateTable
CREATE TABLE "artifact_shares" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "organization_id" INTEGER,
    "scope" "ArtifactShareScope" NOT NULL,
    "target_user_id" INTEGER,
    "token_hash" TEXT,
    "permission" "ArtifactPermission" NOT NULL DEFAULT 'VIEW',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "artifact_shares_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "artifact_shares_scope_target_check" CHECK (
        ("scope" = 'ORGANIZATION' AND "organization_id" IS NOT null AND "target_user_id" IS null AND "token_hash" IS null)
        OR ("scope" = 'USER' AND "target_user_id" IS NOT null AND "token_hash" IS null)
        OR ("scope" = 'PUBLIC_LINK' AND "token_hash" IS NOT null AND "target_user_id" IS null)
    )
);

-- CreateTable
CREATE TABLE "device_logins" (
    "id" SERIAL NOT NULL,
    "device_code" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "status" "device_loginsStatus" NOT NULL DEFAULT 'PENDING',
    "user_id" INTEGER,
    "poll_interval" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "authorized_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),

    CONSTRAINT "device_logins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "task_id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "user_id" TEXT,
    "model_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "organization_id" INTEGER,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "details" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_incidents" (
    "id" SERIAL NOT NULL,
    "service_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "service_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_audit_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "version_start" INTEGER NOT NULL,
    "version_end" INTEGER NOT NULL,
    "items_count" INTEGER NOT NULL DEFAULT 0,
    "conflicts_count" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "details" JSONB,

    CONSTRAINT "sync_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_devices" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "device_name" TEXT,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sync_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatar" TEXT,
    "model_id" TEXT,
    "autonomy_enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "active_start" TEXT NOT NULL DEFAULT '09:00',
    "active_end" TEXT NOT NULL DEFAULT '17:00',
    "active_days" INTEGER [],
    "check_interval" INTEGER NOT NULL DEFAULT 600,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" SERIAL NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "claim_token" TEXT,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_usage" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "task_id" TEXT,
    "conversation_id" INTEGER,
    "user_id" TEXT,
    "plan" TEXT,
    "model" TEXT,
    "stage" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_usage" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "task_id" TEXT,
    "conversation_id" INTEGER,
    "user_id" TEXT,
    "plan" TEXT,
    "tool_name" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "duration_ms" INTEGER,
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "tool_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_traces" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" INTEGER,
    "goal" TEXT NOT NULL,
    "plan" JSONB,
    "steps" JSONB,
    "self_eval" JSONB,
    "report" JSONB,
    "artifacts" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "execution_traces_task_id_key" ON "execution_traces" ("task_id");

-- CreateIndex
CREATE INDEX "execution_traces_user_id_idx" ON "execution_traces" ("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_subscription_id_key" ON "users" ("subscription_id") WHERE "subscription_id" IS NOT null;

-- CreateIndex
CREATE UNIQUE INDEX "users_customer_id_key" ON "users" ("customer_id") WHERE "customer_id" IS NOT null;

-- CreateIndex
CREATE UNIQUE INDEX "users_revenuecat_app_user_id_key" ON "users" ("revenuecat_app_user_id") WHERE "revenuecat_app_user_id" IS NOT null;

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_original_transaction_id_key" ON "users" (
    "mobile_original_transaction_id"
) WHERE "mobile_original_transaction_id" IS NOT null;

-- CreateIndex
CREATE UNIQUE INDEX "users_api_subscription_id_key" ON "users" ("api_subscription_id") WHERE "api_subscription_id" IS NOT null;

-- CreateIndex
CREATE INDEX "users_plan_idx" ON "users" ("plan");

-- CreateIndex
CREATE INDEX "users_is_admin_idx" ON "users" ("is_admin");

-- CreateIndex
CREATE INDEX "users_subscription_status_idx" ON "users" ("subscription_status");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" ("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_domain_key" ON "organizations" ("domain");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_workos_organization_id_key" ON "organizations" ("workos_organization_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships" ("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships" ("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "projects_user_id_idx" ON "projects" ("user_id");

-- CreateIndex
CREATE INDEX "projects_organization_id_idx" ON "projects" ("organization_id");

-- CreateIndex
CREATE INDEX "memories_user_id_idx" ON "memories" ("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provideraccountid_key" ON "accounts" ("provider", "provideraccountid");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions" ("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens" ("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens" ("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_share_id_key" ON "conversations" ("share_id");

-- CreateIndex
CREATE INDEX "conversations_user_id_idx" ON "conversations" ("user_id");

-- CreateIndex
CREATE INDEX "conversations_organization_id_idx" ON "conversations" ("organization_id");

-- CreateIndex
CREATE INDEX "conversations_timestamp_idx" ON "conversations" ("timestamp");

-- CreateIndex
CREATE INDEX "conversations_sync_version_idx" ON "conversations" ("sync_version");

-- CreateIndex
CREATE INDEX "conversations_last_synced_at_idx" ON "conversations" ("last_synced_at");

-- CreateIndex
CREATE INDEX "conversations_user_id_is_deleted_idx" ON "conversations" ("user_id", "is_deleted");

-- CreateIndex
CREATE INDEX "conversations_org_sync_version_idx" ON "conversations" ("organization_id", "sync_version") WHERE "organization_id" IS NOT null;

-- CreateIndex
CREATE UNIQUE INDEX "messages_message_id_key" ON "messages" ("message_id");

-- CreateIndex
CREATE INDEX "messages_is_streaming_is_deleted_created_at_idx" ON "messages" ("is_streaming", "is_deleted", "created_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages" ("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_message_id_idx" ON "messages" ("message_id");

-- CreateIndex
CREATE INDEX "messages_sync_version_idx" ON "messages" ("sync_version");

-- CreateIndex
CREATE INDEX "messages_last_synced_at_idx" ON "messages" ("last_synced_at");

-- CreateIndex
CREATE INDEX "metrics_metric_name_idx" ON "metrics" ("metric_name");

-- CreateIndex
CREATE INDEX "metrics_timestamp_idx" ON "metrics" ("timestamp");

-- CreateIndex
CREATE INDEX "downloads_product_idx" ON "downloads" ("product");

-- CreateIndex
CREATE INDEX "downloads_platform_idx" ON "downloads" ("platform");

-- CreateIndex
CREATE INDEX "downloads_timestamp_idx" ON "downloads" ("timestamp");

-- CreateIndex
CREATE INDEX "downloads_product_platform_idx" ON "downloads" ("product", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "push_notification_tokens_token_key" ON "push_notification_tokens" ("token");

-- CreateIndex
CREATE INDEX "push_notification_tokens_user_id_idx" ON "push_notification_tokens" ("user_id");

-- CreateIndex
CREATE INDEX "rate_limits_user_id_idx" ON "rate_limits" ("user_id");

-- CreateIndex
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits" ("window_start");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_user_id_plan_window_start_key" ON "rate_limits" ("user_id", "plan", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "developer_api_keys_key_hash_key" ON "developer_api_keys" ("key_hash");

-- CreateIndex
CREATE INDEX "developer_api_keys_user_id_idx" ON "developer_api_keys" ("user_id");

-- CreateIndex
CREATE INDEX "developer_api_keys_tier_idx" ON "developer_api_keys" ("tier");

-- CreateIndex
CREATE INDEX "developer_api_usage_window_end_idx" ON "developer_api_usage" ("window_end");

-- CreateIndex
CREATE UNIQUE INDEX "developer_api_usage_api_key_id_window_start_key" ON "developer_api_usage" ("api_key_id", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "developer_files_blob_url_key" ON "developer_files" ("blob_url");

-- CreateIndex
CREATE UNIQUE INDEX "developer_files_blob_path_key" ON "developer_files" ("blob_path");

-- CreateIndex
CREATE UNIQUE INDEX "developer_file_upload_reservations_blob_path_key" ON "developer_file_upload_reservations" ("blob_path");

-- CreateIndex
CREATE INDEX "developer_file_upload_reservations_user_expires_idx" ON "developer_file_upload_reservations" (
    "user_id",
    "expires_at"
)
WHERE "completed_at" IS null;

-- CreateIndex
CREATE INDEX "developer_files_user_id_created_at_idx" ON "developer_files" ("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "developer_files_user_id_deleted_at_idx" ON "developer_files" ("user_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_current_version_id_key" ON "artifacts" ("current_version_id");

-- CreateIndex
CREATE INDEX "artifacts_organization_id_idx" ON "artifacts" ("organization_id");

-- CreateIndex
CREATE INDEX "artifacts_owner_user_id_created_at_idx" ON "artifacts" ("owner_user_id", "created_at");

-- CreateIndex
CREATE INDEX "artifacts_conversation_id_idx" ON "artifacts" ("conversation_id");

-- CreateIndex
CREATE INDEX "artifacts_message_id_idx" ON "artifacts" ("message_id");

-- CreateIndex
CREATE INDEX "artifacts_task_id_idx" ON "artifacts" ("task_id");

-- CreateIndex
CREATE INDEX "artifacts_type_idx" ON "artifacts" ("type");

-- CreateIndex
CREATE INDEX "artifacts_status_idx" ON "artifacts" ("status");

-- CreateIndex
CREATE INDEX "artifacts_visibility_idx" ON "artifacts" ("visibility");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_versions_artifact_id_version_key" ON "artifact_versions" ("artifact_id", "version");

-- CreateIndex
CREATE INDEX "artifact_versions_artifact_id_idx" ON "artifact_versions" ("artifact_id");

-- CreateIndex
CREATE INDEX "artifact_versions_file_id_idx" ON "artifact_versions" ("file_id");

-- CreateIndex
CREATE INDEX "artifact_versions_created_by_user_id_idx" ON "artifact_versions" ("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_shares_token_hash_key" ON "artifact_shares" ("token_hash");

-- CreateIndex
CREATE INDEX "artifact_shares_artifact_id_idx" ON "artifact_shares" ("artifact_id");

-- CreateIndex
CREATE INDEX "artifact_shares_organization_id_idx" ON "artifact_shares" ("organization_id");

-- CreateIndex
CREATE INDEX "artifact_shares_target_user_id_idx" ON "artifact_shares" ("target_user_id");

-- CreateIndex
CREATE INDEX "artifact_shares_scope_idx" ON "artifact_shares" ("scope");

-- CreateIndex
CREATE UNIQUE INDEX "device_logins_device_code_key" ON "device_logins" ("device_code");

-- CreateIndex
CREATE UNIQUE INDEX "device_logins_user_code_key" ON "device_logins" ("user_code");

-- CreateIndex
CREATE INDEX "device_logins_expires_at_idx" ON "device_logins" ("expires_at");

-- CreateIndex
CREATE INDEX "device_logins_status_idx" ON "device_logins" ("status");

-- CreateIndex
CREATE INDEX "tasks_expires_at_idx" ON "tasks" ("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_timestamp_idx" ON "audit_logs" ("user_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_idx" ON "audit_logs" ("organization_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_timestamp_idx" ON "audit_logs" ("organization_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" ("action");

-- CreateIndex
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" ("resource");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs" ("timestamp");

-- CreateIndex
CREATE INDEX "service_incidents_started_at_idx" ON "service_incidents" ("started_at");

-- CreateIndex
CREATE INDEX "service_incidents_service_id_idx" ON "service_incidents" ("service_id");

-- CreateIndex
CREATE INDEX "sync_audit_logs_user_id_idx" ON "sync_audit_logs" ("user_id");

-- CreateIndex
CREATE INDEX "sync_audit_logs_timestamp_idx" ON "sync_audit_logs" ("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "sync_devices_user_id_device_id_key" ON "sync_devices" ("user_id", "device_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_stripe_event_id_key" ON "webhook_events" ("stripe_event_id");

-- CreateIndex
CREATE INDEX "webhook_events_stripe_event_id_idx" ON "webhook_events" ("stripe_event_id");

-- CreateIndex
CREATE INDEX "webhook_events_type_idx" ON "webhook_events" ("type");

-- CreateIndex
CREATE INDEX "token_usage_created_at_idx" ON "token_usage" ("created_at");

-- CreateIndex
CREATE INDEX "token_usage_user_id_idx" ON "token_usage" ("user_id");

-- CreateIndex
CREATE INDEX "token_usage_plan_idx" ON "token_usage" ("plan");

-- CreateIndex
CREATE INDEX "tool_usage_created_at_idx" ON "tool_usage" ("created_at");

-- CreateIndex
CREATE INDEX "tool_usage_tool_name_idx" ON "tool_usage" ("tool_name");

-- CreateIndex
CREATE INDEX "tool_usage_user_id_idx" ON "tool_usage" ("user_id");

-- CreateIndex
CREATE INDEX "agents_user_id_idx" ON "agents" ("user_id");

-- CreateIndex
CREATE INDEX "agents_autonomy_enabled_idx" ON "agents" ("autonomy_enabled");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" (
    "id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" (
    "id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" (
    "id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_notification_tokens" ADD CONSTRAINT "push_notification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_api_keys" ADD CONSTRAINT "developer_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_api_usage" ADD CONSTRAINT "developer_api_usage_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "developer_api_keys" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_storage_quotas" ADD CONSTRAINT "user_storage_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_files" ADD CONSTRAINT "developer_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_file_upload_reservations" ADD CONSTRAINT "developer_file_upload_reservations_user_id_fkey" FOREIGN KEY (
    "user_id"
) REFERENCES "users" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_files" ADD CONSTRAINT "developer_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" (
    "id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" (
    "id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" (
    "id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" (
    "message_id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "developer_files" (
    "id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" (
    "id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "artifact_versions" (
    "id"
) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_shares" ADD CONSTRAINT "artifact_shares_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_shares" ADD CONSTRAINT "artifact_shares_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_shares" ADD CONSTRAINT "artifact_shares_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_logins" ADD CONSTRAINT "device_logins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" (
    "id"
) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "financial_connections" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "organization_id" INTEGER,
    "provider" TEXT NOT NULL,
    "provider_item_id" TEXT NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "products" TEXT [] NOT NULL DEFAULT ARRAY[]::TEXT [],
    "transactions_cursor" TEXT,
    "institution_id" TEXT,
    "institution_name" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "financial_connections_provider_item_id_key" ON "financial_connections" ("provider", "provider_item_id");
CREATE INDEX "financial_connections_user_id_idx" ON "financial_connections" ("user_id");
CREATE INDEX "financial_connections_org_id_idx" ON "financial_connections" ("organization_id");

CREATE TABLE "financial_accounts" (
    "id" SERIAL PRIMARY KEY,
    "connection_id" INTEGER NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mask" TEXT,
    "type" TEXT,
    "subtype" TEXT,
    "current_balance" NUMERIC,
    "available_balance" NUMERIC,
    "iso_currency_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "financial_accounts_connection_provider_account_key" ON "financial_accounts" ("connection_id", "provider_account_id");
CREATE INDEX "financial_accounts_connection_id_idx" ON "financial_accounts" ("connection_id");

CREATE TABLE "financial_transactions" (
    "id" SERIAL PRIMARY KEY,
    "connection_id" INTEGER NOT NULL,
    "provider_transaction_id" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "amount" NUMERIC NOT NULL,
    "iso_currency_code" TEXT,
    "date" DATE NOT NULL,
    "authorized_date" DATE,
    "name" TEXT NOT NULL,
    "merchant_name" TEXT,
    "primary_category" TEXT,
    "detailed_category" TEXT,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "financial_transactions_connection_provider_transaction_key" ON "financial_transactions" (
    "connection_id",
    "provider_transaction_id"
);
CREATE INDEX "financial_transactions_connection_id_idx" ON "financial_transactions" ("connection_id");
CREATE INDEX "financial_transactions_date_idx" ON "financial_transactions" ("date" DESC);

CREATE TABLE "financial_recurring_streams" (
    "id" SERIAL PRIMARY KEY,
    "connection_id" INTEGER NOT NULL,
    "provider_stream_id" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "stream_type" TEXT NOT NULL,
    "merchant_name" TEXT,
    "description" TEXT,
    "frequency" TEXT,
    "last_amount" NUMERIC,
    "iso_currency_code" TEXT,
    "last_date" DATE,
    "status" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "financial_recurring_streams_connection_provider_stream_key" ON "financial_recurring_streams" (
    "connection_id",
    "provider_stream_id"
);
CREATE INDEX "financial_recurring_streams_connection_id_idx" ON "financial_recurring_streams" ("connection_id");

ALTER TABLE "financial_connections" ADD CONSTRAINT "financial_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" (
    "id"
) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financial_connections" ADD CONSTRAINT "financial_connections_organization_id_fkey" FOREIGN KEY (
    "organization_id"
) REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_connection_id_fkey" FOREIGN KEY (
    "connection_id"
) REFERENCES "financial_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_connection_id_fkey" FOREIGN KEY (
    "connection_id"
) REFERENCES "financial_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "financial_recurring_streams" ADD CONSTRAINT "financial_recurring_streams_connection_id_fkey" FOREIGN KEY (
    "connection_id"
) REFERENCES "financial_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
