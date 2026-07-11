-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('STRIPE', 'APP_STORE', 'PLAY_STORE');

-- CreateEnum
CREATE TYPE "DeveloperApiTier" AS ENUM ('STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "DeviceLoginStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'COMPLETED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT,
    "hashedPassword" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "themePreference" TEXT NOT NULL DEFAULT 'dark',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageTimestamp" TIMESTAMP(3),
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionId" TEXT,
    "subscriptionStatus" TEXT,
    "subscriptionSource" "SubscriptionSource",
    "priceId" TEXT,
    "paymentMethodBrand" TEXT,
    "paymentMethodLast4" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "customerId" TEXT,
    "revenuecatAppUserId" TEXT,
    "mobileOriginalTransactionId" TEXT,
    "mobileProductId" TEXT,
    "apiSubscriptionId" TEXT,
    "apiSubscriptionStatus" TEXT,
    "apiTier" "DeveloperApiTier" NOT NULL DEFAULT 'STARTER',
    "apiRequestsUsed" INTEGER NOT NULL DEFAULT 0,
    "apiRequestsLimit" INTEGER NOT NULL DEFAULT 100,
    "apiCurrentPeriodStart" TIMESTAMP(3),
    "apiCurrentPeriodEnd" TIMESTAMP(3),
    "requestsLimit" INTEGER,
    "resetDate" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
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
    "userId" INTEGER NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userInput" TEXT NOT NULL,
    "result" TEXT,
    "executionTime" DOUBLE PRECISION,
    "model" TEXT,
    "agentCount" INTEGER NOT NULL DEFAULT 4,
    "syncVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isStreaming" BOOLEAN NOT NULL DEFAULT false,
    "isAgentStatus" BOOLEAN NOT NULL DEFAULT false,
    "elapsedSeconds" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "sources" JSONB,
    "toolEvents" JSONB,
    "agentStatuses" JSONB,
    "syncVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metricName" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION,
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
    "userAgent" TEXT,
    "ipAddressHash" TEXT,
    "country" TEXT,
    "referrer" TEXT,

    CONSTRAINT "downloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_notification_tokens" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceId" TEXT,
    "appVersion" TEXT,
    "lastRegisteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER,

    CONSTRAINT "push_notification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeveloperApiKey" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "keyHash" TEXT NOT NULL,
    "displayKey" TEXT NOT NULL,
    "name" TEXT,
    "tier" "DeveloperApiTier" NOT NULL DEFAULT 'STARTER',
    "rateLimit" INTEGER NOT NULL DEFAULT 10,
    "monthlyQuota" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "DeveloperApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeveloperApiUsage" (
    "id" SERIAL NOT NULL,
    "apiKeyId" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "endpoint" TEXT,
    "statusCode" INTEGER,
    "responseTime" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeveloperApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceLogin" (
    "id" SERIAL NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "status" "DeviceLoginStatus" NOT NULL DEFAULT 'PENDING',
    "userId" INTEGER,
    "pollInterval" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "authorizedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastPolledAt" TIMESTAMP(3),

    CONSTRAINT "DeviceLogin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "taskId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "userId" TEXT,
    "modelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("taskId")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "username" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "details" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" SERIAL NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_usage" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT,
    "conversationId" INTEGER,
    "userId" TEXT,
    "plan" TEXT,
    "model" TEXT,
    "stage" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_usage" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT,
    "conversationId" INTEGER,
    "userId" TEXT,
    "plan" TEXT,
    "toolName" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "durationMs" INTEGER,
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "tool_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_plan_idx" ON "users"("plan");

-- CreateIndex
CREATE INDEX "users_isAdmin_idx" ON "users"("isAdmin");

-- CreateIndex
CREATE INDEX "users_subscriptionStatus_idx" ON "users"("subscriptionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "conversations_userId_idx" ON "conversations"("userId");

-- CreateIndex
CREATE INDEX "conversations_timestamp_idx" ON "conversations"("timestamp");

-- CreateIndex
CREATE INDEX "conversations_syncVersion_idx" ON "conversations"("syncVersion");

-- CreateIndex
CREATE INDEX "conversations_lastSyncedAt_idx" ON "conversations"("lastSyncedAt");

-- CreateIndex
CREATE INDEX "conversations_userId_isDeleted_idx" ON "conversations"("userId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "messages_messageId_key" ON "messages"("messageId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_messageId_idx" ON "messages"("messageId");

-- CreateIndex
CREATE INDEX "messages_syncVersion_idx" ON "messages"("syncVersion");

-- CreateIndex
CREATE INDEX "messages_lastSyncedAt_idx" ON "messages"("lastSyncedAt");

-- CreateIndex
CREATE INDEX "metrics_metricName_idx" ON "metrics"("metricName");

-- CreateIndex
CREATE INDEX "metrics_timestamp_idx" ON "metrics"("timestamp");

-- CreateIndex
CREATE INDEX "downloads_product_idx" ON "downloads"("product");

-- CreateIndex
CREATE INDEX "downloads_platform_idx" ON "downloads"("platform");

-- CreateIndex
CREATE INDEX "downloads_timestamp_idx" ON "downloads"("timestamp");

-- CreateIndex
CREATE INDEX "downloads_product_platform_idx" ON "downloads"("product", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "push_notification_tokens_token_key" ON "push_notification_tokens"("token");

-- CreateIndex
CREATE INDEX "push_notification_tokens_userId_idx" ON "push_notification_tokens"("userId");

-- CreateIndex
CREATE INDEX "rate_limits_userId_idx" ON "rate_limits"("userId");

-- CreateIndex
CREATE INDEX "rate_limits_windowStart_idx" ON "rate_limits"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_userId_plan_windowStart_key" ON "rate_limits"("userId", "plan", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "DeveloperApiKey_keyHash_key" ON "DeveloperApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "DeveloperApiKey_userId_idx" ON "DeveloperApiKey"("userId");

-- CreateIndex
CREATE INDEX "DeveloperApiKey_tier_idx" ON "DeveloperApiKey"("tier");

-- CreateIndex
CREATE INDEX "DeveloperApiUsage_windowEnd_idx" ON "DeveloperApiUsage"("windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "DeveloperApiUsage_apiKeyId_windowStart_key" ON "DeveloperApiUsage"("apiKeyId", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLogin_deviceCode_key" ON "DeviceLogin"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLogin_userCode_key" ON "DeviceLogin"("userCode");

-- CreateIndex
CREATE INDEX "DeviceLogin_expiresAt_idx" ON "DeviceLogin"("expiresAt");

-- CreateIndex
CREATE INDEX "DeviceLogin_status_idx" ON "DeviceLogin"("status");

-- CreateIndex
CREATE INDEX "tasks_expiresAt_idx" ON "tasks"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs"("resource");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_stripeEventId_key" ON "webhook_events"("stripeEventId");

-- CreateIndex
CREATE INDEX "webhook_events_stripeEventId_idx" ON "webhook_events"("stripeEventId");

-- CreateIndex
CREATE INDEX "webhook_events_type_idx" ON "webhook_events"("type");

-- CreateIndex
CREATE INDEX "token_usage_createdAt_idx" ON "token_usage"("createdAt");

-- CreateIndex
CREATE INDEX "token_usage_userId_idx" ON "token_usage"("userId");

-- CreateIndex
CREATE INDEX "token_usage_plan_idx" ON "token_usage"("plan");

-- CreateIndex
CREATE INDEX "tool_usage_createdAt_idx" ON "tool_usage"("createdAt");

-- CreateIndex
CREATE INDEX "tool_usage_toolName_idx" ON "tool_usage"("toolName");

-- CreateIndex
CREATE INDEX "tool_usage_userId_idx" ON "tool_usage"("userId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_notification_tokens" ADD CONSTRAINT "push_notification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeveloperApiKey" ADD CONSTRAINT "DeveloperApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeveloperApiUsage" ADD CONSTRAINT "DeveloperApiUsage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "DeveloperApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLogin" ADD CONSTRAINT "DeviceLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
