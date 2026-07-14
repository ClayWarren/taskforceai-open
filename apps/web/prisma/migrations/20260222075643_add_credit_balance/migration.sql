-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "model_id" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "rating" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trace" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auto_recharge_amount" DECIMAL(10,2),
ADD COLUMN     "auto_recharge_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "auto_recharge_threshold" DECIMAL(10,2),
ADD COLUMN     "credit_balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "trust_layer_enabled" BOOLEAN NOT NULL DEFAULT false;

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
CREATE UNIQUE INDEX "execution_traces_task_id_key" ON "execution_traces"("task_id");

-- CreateIndex
CREATE INDEX "execution_traces_user_id_idx" ON "execution_traces"("user_id");

-- CreateIndex
CREATE INDEX "execution_traces_task_id_idx" ON "execution_traces"("task_id");
