-- 2026-11-14: Admin AI console - an Admin marks an AI answer helpful / not helpful so gaps in the Knowledge Base show up.
-- CreateEnum
CREATE TYPE "SupportAiFeedback" AS ENUM ('HELPFUL', 'NOT_HELPFUL');

-- AlterTable
ALTER TABLE "support_messages" ADD COLUMN     "ai_feedback" "SupportAiFeedback",
ADD COLUMN     "ai_feedback_at" TIMESTAMPTZ(6),
ADD COLUMN     "ai_feedback_by_id" UUID,
ADD COLUMN     "ai_feedback_note" TEXT;

-- CreateIndex
CREATE INDEX "support_messages_sender_type_created_at_idx" ON "support_messages"("sender_type", "created_at");

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ai_feedback_by_id_fkey" FOREIGN KEY ("ai_feedback_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
