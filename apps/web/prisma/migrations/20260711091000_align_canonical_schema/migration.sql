CREATE TABLE IF NOT EXISTS "financial_connections" (
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
    "updated_at" TIMESTAMP(3) NOT NULL,
    UNIQUE ("provider", "provider_item_id"),
    CONSTRAINT "financial_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "financial_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" (
        "id"
    ) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "financial_connections_user_id_idx" ON "financial_connections" ("user_id");
CREATE INDEX IF NOT EXISTS "financial_connections_organization_id_idx" ON "financial_connections" ("organization_id");

CREATE TABLE IF NOT EXISTS "financial_accounts" (
    "id" SERIAL PRIMARY KEY,
    "connection_id" INTEGER NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mask" TEXT,
    "type" TEXT,
    "subtype" TEXT,
    "current_balance" DECIMAL(65, 30),
    "available_balance" DECIMAL(65, 30),
    "iso_currency_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    UNIQUE ("connection_id", "provider_account_id"),
    CONSTRAINT "financial_accounts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "financial_connections" (
        "id"
    ) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "financial_accounts_connection_id_idx" ON "financial_accounts" ("connection_id");

CREATE TABLE IF NOT EXISTS "financial_transactions" (
    "id" SERIAL PRIMARY KEY,
    "connection_id" INTEGER NOT NULL,
    "provider_transaction_id" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "amount" DECIMAL(65, 30) NOT NULL,
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
    "updated_at" TIMESTAMP(3) NOT NULL,
    UNIQUE ("connection_id", "provider_transaction_id"),
    CONSTRAINT "financial_transactions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "financial_connections" (
        "id"
    ) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "financial_transactions_connection_id_idx" ON "financial_transactions" ("connection_id");
CREATE INDEX IF NOT EXISTS "financial_transactions_date_idx" ON "financial_transactions" ("date");

CREATE TABLE IF NOT EXISTS "financial_recurring_streams" (
    "id" SERIAL PRIMARY KEY,
    "connection_id" INTEGER NOT NULL,
    "provider_stream_id" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "stream_type" TEXT NOT NULL,
    "merchant_name" TEXT,
    "description" TEXT,
    "frequency" TEXT,
    "last_amount" DECIMAL(65, 30),
    "iso_currency_code" TEXT,
    "last_date" DATE,
    "status" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    UNIQUE ("connection_id", "provider_stream_id"),
    CONSTRAINT "financial_recurring_streams_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "financial_connections" (
        "id"
    ) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "financial_recurring_streams_connection_id_idx"
ON "financial_recurring_streams" ("connection_id");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_totp_secret" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_verified_at" TIMESTAMP(3);

ALTER TABLE "execution_traces" ADD COLUMN IF NOT EXISTS "report" JSONB;

ALTER TABLE "webhook_events"
ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "webhook_events"
ADD COLUMN IF NOT EXISTS "claim_token" TEXT;

ALTER TABLE "webhook_events"
ALTER COLUMN "processed_at" DROP DEFAULT,
ALTER COLUMN "processed_at" DROP NOT NULL;
