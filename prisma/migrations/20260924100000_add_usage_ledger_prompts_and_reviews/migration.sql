-- CreateEnum
CREATE TYPE "AiUsageEntryType" AS ENUM ('GENERATION', 'PROMPT_COMPOSE');

-- CreateEnum
CREATE TYPE "PlanReviewField" AS ENUM ('SCENE', 'OVERALL_SCRIPT', 'DURATION', 'TOKEN_ESTIMATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ComplianceCheckType" ADD VALUE 'WATERMARK';
ALTER TYPE "ComplianceCheckType" ADD VALUE 'REAL_PERSON_LIKENESS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GenerationJobType" ADD VALUE 'SCENE_IMAGE';
ALTER TYPE "GenerationJobType" ADD VALUE 'SCENE_VIDEO';
ALTER TYPE "GenerationJobType" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "generation_jobs" ADD COLUMN     "custom_function" TEXT,
ADD COLUMN     "estimated_token_cost" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "output_duration_seconds" DECIMAL(10,2),
ADD COLUMN     "raw_prompt" TEXT;

-- AlterTable
ALTER TABLE "plan_reviews" ADD COLUMN     "field" "PlanReviewField" NOT NULL DEFAULT 'SCENE';

-- AlterTable
ALTER TABLE "scenes" ADD COLUMN     "estimated_tokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_usage_ledger" (
    "id" UUID NOT NULL,
    "generation_job_id" UUID NOT NULL,
    "production_plan_id" UUID NOT NULL,
    "quota_allocation_id" UUID,
    "entry_type" "AiUsageEntryType" NOT NULL,
    "output_duration_seconds" DECIMAL(10,2),
    "token_cost" INTEGER NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_job_prompts" (
    "id" UUID NOT NULL,
    "generation_job_id" UUID NOT NULL,
    "composed_prompt" TEXT NOT NULL,
    "compose_model" VARCHAR(100) NOT NULL,
    "compose_token_cost" INTEGER NOT NULL DEFAULT 0,
    "seed" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_job_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_ledger_production_plan_id_idx" ON "ai_usage_ledger"("production_plan_id");

-- CreateIndex
CREATE INDEX "ai_usage_ledger_quota_allocation_id_idx" ON "ai_usage_ledger"("quota_allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_job_prompts_generation_job_id_key" ON "generation_job_prompts"("generation_job_id");

-- AddForeignKey
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_quota_allocation_id_fkey" FOREIGN KEY ("quota_allocation_id") REFERENCES "quota_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_job_prompts" ADD CONSTRAINT "generation_job_prompts_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Non-negative token amounts (docs/mf1_database_schema.sql, BR-38/BR-41)
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "chk_usage_token_cost_nonnegative" CHECK ("token_cost" >= 0);
ALTER TABLE "generation_job_prompts" ADD CONSTRAINT "chk_compose_token_cost_nonnegative" CHECK ("compose_token_cost" >= 0);
ALTER TABLE "generation_jobs" ADD CONSTRAINT "chk_estimated_token_cost_nonnegative" CHECK ("estimated_token_cost" >= 0);
ALTER TABLE "scenes" ADD CONSTRAINT "chk_scene_estimated_tokens_nonnegative" CHECK ("estimated_tokens" >= 0);
