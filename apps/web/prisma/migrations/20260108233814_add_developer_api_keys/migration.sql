/*
  Warnings:

  - You are about to drop the column `providerAccountId` on the `accounts` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `accounts` table. All the data in the column will be lost.
  - You are about to drop the column `errorMessage` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `ipAddress` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `resourceId` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `userAgent` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `agentCount` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `deviceId` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `executionTime` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `isDeleted` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `lastSyncedAt` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `syncVersion` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `userInput` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `ipAddressHash` on the `downloads` table. All the data in the column will be lost.
  - You are about to drop the column `userAgent` on the `downloads` table. All the data in the column will be lost.
  - You are about to drop the column `agentStatuses` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `conversationId` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `deviceId` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `elapsedSeconds` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `isAgentStatus` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `isDeleted` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `isStreaming` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `lastSyncedAt` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `messageId` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `syncVersion` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `toolEvents` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `metricName` on the `metrics` table. All the data in the column will be lost.
  - You are about to drop the column `metricValue` on the `metrics` table. All the data in the column will be lost.
  - You are about to drop the column `appVersion` on the `push_notification_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `push_notification_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `deviceId` on the `push_notification_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `lastRegisteredAt` on the `push_notification_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `push_notification_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `push_notification_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `rate_limits` table. All the data in the column will be lost.
  - You are about to drop the column `windowStart` on the `rate_limits` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `sessions` table. All the data in the column will be lost.
  - The primary key for the `tasks` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `createdAt` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `expiresAt` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `modelId` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `taskId` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `completionTokens` on the `token_usage` table. All the data in the column will be lost.
  - You are about to drop the column `conversationId` on the `token_usage` table. All the data in the column will be lost.
  - You are about to drop the column `costMicros` on the `token_usage` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `token_usage` table. All the data in the column will be lost.
  - You are about to drop the column `promptTokens` on the `token_usage` table. All the data in the column will be lost.
  - You are about to drop the column `taskId` on the `token_usage` table. All the data in the column will be lost.
  - You are about to drop the column `totalTokens` on the `token_usage` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `token_usage` table. All the data in the column will be lost.
  - You are about to drop the column `conversationId` on the `tool_usage` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `tool_usage` table. All the data in the column will be lost.
  - You are about to drop the column `durationMs` on the `tool_usage` table. All the data in the column will be lost.
  - You are about to drop the column `taskId` on the `tool_usage` table. All the data in the column will be lost.
  - You are about to drop the column `toolName` on the `tool_usage` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `tool_usage` table. All the data in the column will be lost.
  - You are about to drop the column `apiCurrentPeriodEnd` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `apiCurrentPeriodStart` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `apiRequestsLimit` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `apiRequestsUsed` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `apiSubscriptionId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `apiSubscriptionStatus` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `apiTier` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `cancelAtPeriodEnd` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `currentPeriodEnd` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `currentPeriodStart` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `customerId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `fullName` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `hashedPassword` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `isAdmin` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `lastMessageTimestamp` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `messageCount` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `mobileOriginalTransactionId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `mobileProductId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `paymentMethodBrand` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `paymentMethodLast4` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `priceId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `requestsLimit` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `resetDate` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `revenuecatAppUserId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `subscriptionId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `subscriptionSource` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `subscriptionStatus` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `themePreference` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `processedAt` on the `webhook_events` table. All the data in the column will be lost.
  - You are about to drop the column `stripeEventId` on the `webhook_events` table. All the data in the column will be lost.
  - You are about to drop the `DeveloperApiKey` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DeveloperApiUsage` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[provider,provideraccountid]` on the table `accounts` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[message_id]` on the table `messages` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[user_id,plan,window_start]` on the table `rate_limits` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripe_event_id]` on the table `webhook_events` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `provideraccountid` to the `accounts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_id` to the `accounts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_input` to the `conversations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `conversation_id` to the `messages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `message_id` to the `messages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `metric_name` to the `metrics` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `push_notification_tokens` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_id` to the `rate_limits` table without a default value. This is not possible if the table is not empty.
  - Added the required column `window_start` to the `rate_limits` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_id` to the `sessions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `expires_at` to the `tasks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `task_id` to the `tasks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tool_name` to the `tool_usage` table without a default value. This is not possible if the table is not empty.
  - Added the required column `hashed_password` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `stripe_event_id` to the `webhook_events` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "DeveloperApiKey" DROP CONSTRAINT "DeveloperApiKey_userId_fkey";

-- DropForeignKey
ALTER TABLE "DeveloperApiUsage" DROP CONSTRAINT "DeveloperApiUsage_apiKeyId_fkey";

-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_userId_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "push_notification_tokens" DROP CONSTRAINT "push_notification_tokens_userId_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_userId_fkey";

-- DropIndex
DROP INDEX "accounts_provider_providerAccountId_key";

-- DropIndex
DROP INDEX "audit_logs_userId_idx";

-- DropIndex
DROP INDEX "conversations_lastSyncedAt_idx";

-- DropIndex
DROP INDEX "conversations_syncVersion_idx";

-- DropIndex
DROP INDEX "conversations_userId_idx";

-- DropIndex
DROP INDEX "conversations_userId_isDeleted_idx";

-- DropIndex
DROP INDEX "messages_conversationId_createdAt_idx";

-- DropIndex
DROP INDEX "messages_lastSyncedAt_idx";

-- DropIndex
DROP INDEX "messages_messageId_idx";

-- DropIndex
DROP INDEX "messages_messageId_key";

-- DropIndex
DROP INDEX "messages_syncVersion_idx";

-- DropIndex
DROP INDEX "metrics_metricName_idx";

-- DropIndex
DROP INDEX "push_notification_tokens_userId_idx";

-- DropIndex
DROP INDEX "rate_limits_userId_idx";

-- DropIndex
DROP INDEX "rate_limits_userId_plan_windowStart_key";

-- DropIndex
DROP INDEX "rate_limits_windowStart_idx";

-- DropIndex
DROP INDEX "tasks_expiresAt_idx";

-- DropIndex
DROP INDEX "token_usage_createdAt_idx";

-- DropIndex
DROP INDEX "token_usage_userId_idx";

-- DropIndex
DROP INDEX "tool_usage_createdAt_idx";

-- DropIndex
DROP INDEX "tool_usage_toolName_idx";

-- DropIndex
DROP INDEX "tool_usage_userId_idx";

-- DropIndex
DROP INDEX "users_isAdmin_idx";

-- DropIndex
DROP INDEX "users_subscriptionStatus_idx";

-- DropIndex
DROP INDEX "webhook_events_stripeEventId_idx";

-- DropIndex
DROP INDEX "webhook_events_stripeEventId_key";

-- AlterTable
ALTER TABLE "accounts" DROP COLUMN "providerAccountId",
DROP COLUMN "userId",
ADD COLUMN     "provideraccountid" TEXT NOT NULL,
ADD COLUMN     "user_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "audit_logs" DROP COLUMN "errorMessage",
DROP COLUMN "ipAddress",
DROP COLUMN "resourceId",
DROP COLUMN "userAgent",
DROP COLUMN "userId",
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "resource_id" TEXT,
ADD COLUMN     "user_agent" TEXT,
ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "agentCount",
DROP COLUMN "deviceId",
DROP COLUMN "executionTime",
DROP COLUMN "isDeleted",
DROP COLUMN "lastSyncedAt",
DROP COLUMN "syncVersion",
DROP COLUMN "updatedAt",
DROP COLUMN "userId",
DROP COLUMN "userInput",
ADD COLUMN     "agent_count" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "device_id" TEXT,
ADD COLUMN     "execution_time" DOUBLE PRECISION,
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sync_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_id" TEXT,
ADD COLUMN     "user_input" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "downloads" DROP COLUMN "ipAddressHash",
DROP COLUMN "userAgent",
ADD COLUMN     "ip_address_hash" TEXT,
ADD COLUMN     "user_agent" TEXT;

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "agentStatuses",
DROP COLUMN "conversationId",
DROP COLUMN "createdAt",
DROP COLUMN "deviceId",
DROP COLUMN "elapsedSeconds",
DROP COLUMN "isAgentStatus",
DROP COLUMN "isDeleted",
DROP COLUMN "isStreaming",
DROP COLUMN "lastSyncedAt",
DROP COLUMN "messageId",
DROP COLUMN "syncVersion",
DROP COLUMN "toolEvents",
DROP COLUMN "updatedAt",
ADD COLUMN     "agent_statuses" JSONB,
ADD COLUMN     "conversation_id" INTEGER NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "device_id" TEXT,
ADD COLUMN     "elapsed_seconds" DOUBLE PRECISION,
ADD COLUMN     "is_agent_status" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_streaming" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "message_id" TEXT NOT NULL,
ADD COLUMN     "sync_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tool_events" JSONB,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "metrics" DROP COLUMN "metricName",
DROP COLUMN "metricValue",
ADD COLUMN     "metric_name" TEXT NOT NULL,
ADD COLUMN     "metric_value" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "push_notification_tokens" DROP COLUMN "appVersion",
DROP COLUMN "createdAt",
DROP COLUMN "deviceId",
DROP COLUMN "lastRegisteredAt",
DROP COLUMN "updatedAt",
DROP COLUMN "userId",
ADD COLUMN     "app_version" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "device_id" TEXT,
ADD COLUMN     "last_registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "user_id" INTEGER;

-- AlterTable
ALTER TABLE "rate_limits" DROP COLUMN "userId",
DROP COLUMN "windowStart",
ADD COLUMN     "user_id" TEXT NOT NULL,
ADD COLUMN     "window_start" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "userId",
ADD COLUMN     "user_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "expiresAt",
DROP COLUMN "modelId",
DROP COLUMN "taskId",
DROP COLUMN "userId",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expires_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "model_id" TEXT,
ADD COLUMN     "task_id" TEXT NOT NULL,
ADD COLUMN     "user_id" TEXT,
ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("task_id");

-- AlterTable
ALTER TABLE "token_usage" DROP COLUMN "completionTokens",
DROP COLUMN "conversationId",
DROP COLUMN "costMicros",
DROP COLUMN "createdAt",
DROP COLUMN "promptTokens",
DROP COLUMN "taskId",
DROP COLUMN "totalTokens",
DROP COLUMN "userId",
ADD COLUMN     "completion_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "conversation_id" INTEGER,
ADD COLUMN     "cost_micros" INTEGER,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "task_id" TEXT,
ADD COLUMN     "total_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "tool_usage" DROP COLUMN "conversationId",
DROP COLUMN "createdAt",
DROP COLUMN "durationMs",
DROP COLUMN "taskId",
DROP COLUMN "toolName",
DROP COLUMN "userId",
ADD COLUMN     "conversation_id" INTEGER,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "task_id" TEXT,
ADD COLUMN     "tool_name" TEXT NOT NULL,
ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "apiCurrentPeriodEnd",
DROP COLUMN "apiCurrentPeriodStart",
DROP COLUMN "apiRequestsLimit",
DROP COLUMN "apiRequestsUsed",
DROP COLUMN "apiSubscriptionId",
DROP COLUMN "apiSubscriptionStatus",
DROP COLUMN "apiTier",
DROP COLUMN "cancelAtPeriodEnd",
DROP COLUMN "currentPeriodEnd",
DROP COLUMN "currentPeriodStart",
DROP COLUMN "customerId",
DROP COLUMN "fullName",
DROP COLUMN "hashedPassword",
DROP COLUMN "isAdmin",
DROP COLUMN "lastMessageTimestamp",
DROP COLUMN "messageCount",
DROP COLUMN "mobileOriginalTransactionId",
DROP COLUMN "mobileProductId",
DROP COLUMN "paymentMethodBrand",
DROP COLUMN "paymentMethodLast4",
DROP COLUMN "priceId",
DROP COLUMN "requestsLimit",
DROP COLUMN "resetDate",
DROP COLUMN "revenuecatAppUserId",
DROP COLUMN "subscriptionId",
DROP COLUMN "subscriptionSource",
DROP COLUMN "subscriptionStatus",
DROP COLUMN "themePreference",
ADD COLUMN     "api_current_period_end" TIMESTAMP(3),
ADD COLUMN     "api_current_period_start" TIMESTAMP(3),
ADD COLUMN     "api_requests_limit" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "api_requests_used" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "api_subscription_id" TEXT,
ADD COLUMN     "api_subscription_status" TEXT,
ADD COLUMN     "api_tier" "DeveloperApiTier" NOT NULL DEFAULT 'STARTER',
ADD COLUMN     "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "current_period_end" TIMESTAMP(3),
ADD COLUMN     "current_period_start" TIMESTAMP(3),
ADD COLUMN     "customer_id" TEXT,
ADD COLUMN     "full_name" TEXT,
ADD COLUMN     "hashed_password" TEXT NOT NULL,
ADD COLUMN     "is_admin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_message_timestamp" TIMESTAMP(3),
ADD COLUMN     "message_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mobile_original_transaction_id" TEXT,
ADD COLUMN     "mobile_product_id" TEXT,
ADD COLUMN     "payment_method_brand" TEXT,
ADD COLUMN     "payment_method_last4" TEXT,
ADD COLUMN     "price_id" TEXT,
ADD COLUMN     "requests_limit" INTEGER,
ADD COLUMN     "reset_date" TIMESTAMP(3),
ADD COLUMN     "revenuecat_app_user_id" TEXT,
ADD COLUMN     "subscription_id" TEXT,
ADD COLUMN     "subscription_source" "SubscriptionSource",
ADD COLUMN     "subscription_status" TEXT,
ADD COLUMN     "theme_preference" TEXT NOT NULL DEFAULT 'dark';

-- AlterTable
ALTER TABLE "webhook_events" DROP COLUMN "processedAt",
DROP COLUMN "stripeEventId",
ADD COLUMN     "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "stripe_event_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "DeveloperApiKey";

-- DropTable
DROP TABLE "DeveloperApiUsage";

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

-- CreateIndex
CREATE UNIQUE INDEX "developer_api_keys_key_hash_key" ON "developer_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "developer_api_keys_user_id_idx" ON "developer_api_keys"("user_id");

-- CreateIndex
CREATE INDEX "developer_api_keys_tier_idx" ON "developer_api_keys"("tier");

-- CreateIndex
CREATE INDEX "developer_api_usage_window_end_idx" ON "developer_api_usage"("window_end");

-- CreateIndex
CREATE UNIQUE INDEX "developer_api_usage_api_key_id_window_start_key" ON "developer_api_usage"("api_key_id", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provideraccountid_key" ON "accounts"("provider", "provideraccountid");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "conversations_user_id_idx" ON "conversations"("user_id");

-- CreateIndex
CREATE INDEX "conversations_sync_version_idx" ON "conversations"("sync_version");

-- CreateIndex
CREATE INDEX "conversations_last_synced_at_idx" ON "conversations"("last_synced_at");

-- CreateIndex
CREATE INDEX "conversations_user_id_is_deleted_idx" ON "conversations"("user_id", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "messages_message_id_key" ON "messages"("message_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_message_id_idx" ON "messages"("message_id");

-- CreateIndex
CREATE INDEX "messages_sync_version_idx" ON "messages"("sync_version");

-- CreateIndex
CREATE INDEX "messages_last_synced_at_idx" ON "messages"("last_synced_at");

-- CreateIndex
CREATE INDEX "metrics_metric_name_idx" ON "metrics"("metric_name");

-- CreateIndex
CREATE INDEX "push_notification_tokens_user_id_idx" ON "push_notification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "rate_limits_user_id_idx" ON "rate_limits"("user_id");

-- CreateIndex
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits"("window_start");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_user_id_plan_window_start_key" ON "rate_limits"("user_id", "plan", "window_start");

-- CreateIndex
CREATE INDEX "tasks_expires_at_idx" ON "tasks"("expires_at");

-- CreateIndex
CREATE INDEX "token_usage_created_at_idx" ON "token_usage"("created_at");

-- CreateIndex
CREATE INDEX "token_usage_user_id_idx" ON "token_usage"("user_id");

-- CreateIndex
CREATE INDEX "tool_usage_created_at_idx" ON "tool_usage"("created_at");

-- CreateIndex
CREATE INDEX "tool_usage_tool_name_idx" ON "tool_usage"("tool_name");

-- CreateIndex
CREATE INDEX "tool_usage_user_id_idx" ON "tool_usage"("user_id");

-- CreateIndex
CREATE INDEX "users_is_admin_idx" ON "users"("is_admin");

-- CreateIndex
CREATE INDEX "users_subscription_status_idx" ON "users"("subscription_status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_stripe_event_id_key" ON "webhook_events"("stripe_event_id");

-- CreateIndex
CREATE INDEX "webhook_events_stripe_event_id_idx" ON "webhook_events"("stripe_event_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_notification_tokens" ADD CONSTRAINT "push_notification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_api_keys" ADD CONSTRAINT "developer_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_api_usage" ADD CONSTRAINT "developer_api_usage_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "developer_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
