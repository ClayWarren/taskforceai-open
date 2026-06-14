/*
  Warnings:

  - You are about to drop the column `activeDays` on the `agents` table. All the data in the column will be lost.
  - You are about to drop the column `activeEnd` on the `agents` table. All the data in the column will be lost.
  - You are about to drop the column `activeStart` on the `agents` table. All the data in the column will be lost.
  - You are about to drop the column `checkInterval` on the `agents` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "agents" DROP COLUMN "activeDays",
DROP COLUMN "activeEnd",
DROP COLUMN "activeStart",
DROP COLUMN "checkInterval",
ADD COLUMN     "active_days" INTEGER[],
ADD COLUMN     "active_end" TEXT NOT NULL DEFAULT '17:00',
ADD COLUMN     "active_start" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "check_interval" INTEGER NOT NULL DEFAULT 600;
