/*
  Warnings:

  - You are about to drop the column `paid_at` on the `coin_top_ups` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `coin_top_ups` table. All the data in the column will be lost.
  - You are about to drop the column `provider_payment_id` on the `coin_top_ups` table. All the data in the column will be lost.
  - You are about to drop the column `provider_txn_id` on the `coin_top_ups` table. All the data in the column will be lost.
  - You are about to drop the column `redirect_url` on the `coin_top_ups` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED');

-- DropIndex
DROP INDEX "coin_top_ups_provider_provider_txn_id_key";

-- AlterTable
ALTER TABLE "coin_top_ups" DROP COLUMN "paid_at",
DROP COLUMN "provider",
DROP COLUMN "provider_payment_id",
DROP COLUMN "provider_txn_id",
DROP COLUMN "redirect_url";

-- AlterTable
ALTER TABLE "payment_callbacks" ADD COLUMN     "payment_id" UUID;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "coin_top_up_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "amount_vnd" INTEGER NOT NULL,
    "provider_txn_id" VARCHAR(100) NOT NULL,
    "provider_payment_id" VARCHAR(100),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "redirect_url" VARCHAR(1000),
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_user_id_created_at_idx" ON "payments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_txn_id_key" ON "payments"("provider", "provider_txn_id");

-- CreateIndex
CREATE INDEX "payment_callbacks_payment_id_idx" ON "payment_callbacks"("payment_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_coin_top_up_id_fkey" FOREIGN KEY ("coin_top_up_id") REFERENCES "coin_top_ups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_callbacks" ADD CONSTRAINT "payment_callbacks_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
