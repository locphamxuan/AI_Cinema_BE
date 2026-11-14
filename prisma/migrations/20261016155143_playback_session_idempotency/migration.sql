/*
  Warnings:

  - A unique constraint covering the columns `[idempotency_key]` on the table `streaming_sessions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "streaming_sessions" ADD COLUMN     "idempotency_key" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "streaming_sessions_idempotency_key_key" ON "streaming_sessions"("idempotency_key");
