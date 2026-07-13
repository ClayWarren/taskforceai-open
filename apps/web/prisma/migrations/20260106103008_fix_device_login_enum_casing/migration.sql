/*
  Warnings:

  - The `status` column on the `device_logins` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "device_loginsStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'COMPLETED', 'EXPIRED');

-- AlterTable
ALTER TABLE "device_logins" DROP COLUMN "status",
ADD COLUMN     "status" "device_loginsStatus" NOT NULL DEFAULT 'PENDING';

-- DropEnum
DROP TYPE "DeviceLoginStatus";

-- CreateIndex
CREATE INDEX "device_logins_status_idx" ON "device_logins"("status");
