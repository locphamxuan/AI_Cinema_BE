-- A Creator's request for more AI tokens on a plan; approving it grants a TOP_UP allocation.

-- CreateEnum
CREATE TYPE "QuotaRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "quota_requests" (
    "id" UUID NOT NULL,
    "production_plan_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "QuotaRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decision_note" TEXT,
    "quota_allocation_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "quota_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quota_requests_quota_allocation_id_key" ON "quota_requests"("quota_allocation_id");

-- CreateIndex
CREATE INDEX "quota_requests_production_plan_id_status_idx" ON "quota_requests"("production_plan_id", "status");

-- AddForeignKey
ALTER TABLE "quota_requests" ADD CONSTRAINT "quota_requests_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_requests" ADD CONSTRAINT "quota_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_requests" ADD CONSTRAINT "quota_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_requests" ADD CONSTRAINT "quota_requests_quota_allocation_id_fkey" FOREIGN KEY ("quota_allocation_id") REFERENCES "quota_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

