/*
  Warnings:

  - You are about to drop the `DeviceLogin` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "DeviceLogin" DROP CONSTRAINT "DeviceLogin_userId_fkey";

-- DropTable
DROP TABLE "DeviceLogin";

-- CreateTable
CREATE TABLE "device_logins" (
    "id" SERIAL NOT NULL,
    "device_code" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "status" "DeviceLoginStatus" NOT NULL DEFAULT 'PENDING',
    "user_id" INTEGER,
    "poll_interval" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "authorized_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),

    CONSTRAINT "device_logins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_logins_device_code_key" ON "device_logins"("device_code");

-- CreateIndex
CREATE UNIQUE INDEX "device_logins_user_code_key" ON "device_logins"("user_code");

-- CreateIndex
CREATE INDEX "device_logins_expires_at_idx" ON "device_logins"("expires_at");

-- CreateIndex
CREATE INDEX "device_logins_status_idx" ON "device_logins"("status");

-- AddForeignKey
ALTER TABLE "device_logins" ADD CONSTRAINT "device_logins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
