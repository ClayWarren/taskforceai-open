ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_subscription_event_created_at" TIMESTAMP(3);
