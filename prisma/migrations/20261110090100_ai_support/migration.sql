-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('AI_HANDLING', 'WAITING_FOR_STAFF', 'STAFF_HANDLING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportEscalationReason" AS ENUM ('AI_UNAVAILABLE', 'INSUFFICIENT_INFO', 'ACCOUNT_VERIFICATION', 'MEMBER_REQUEST', 'STAFF_NEEDED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportCloseReason" AS ENUM ('AI_RESOLVED', 'STAFF_RESOLVED', 'INACTIVITY', 'MEMBER_CLOSED');

-- CreateEnum
CREATE TYPE "SupportAudience" AS ENUM ('MEMBER', 'STAFF', 'ALL');

-- CreateEnum
CREATE TYPE "KnowledgeArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KnowledgeIndexStatus" AS ENUM ('PENDING', 'INDEXING', 'INDEXED', 'FAILED');

-- CreateEnum
CREATE TYPE "KnowledgeSource" AS ENUM ('MANUAL', 'POLICY', 'PLAN', 'FAQ');

-- CreateEnum
CREATE TYPE "SupportSenderType" AS ENUM ('MEMBER', 'AI_CHATBOT', 'SUPPORT_AGENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "support_conversations" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'AI_HANDLING',
    "assigned_agent_id" UUID,
    "escalation_reason" "SupportEscalationReason",
    "escalation_note" TEXT,
    "ai_summary" TEXT,
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "last_message_at" TIMESTAMPTZ(6),
    "last_member_message_at" TIMESTAMPTZ(6),
    "last_staff_message_at" TIMESTAMPTZ(6),
    "escalated_at" TIMESTAMPTZ(6),
    "claimed_at" TIMESTAMPTZ(6),
    "first_staff_reply_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "close_reason" "SupportCloseReason",
    "resolution_note" TEXT,
    "ai_turns" INTEGER NOT NULL DEFAULT 0,
    "ai_resolution_suggested_at" TIMESTAMPTZ(6),
    "ai_turn_started_at" TIMESTAMPTZ(6),
    "ai_failure_count" INTEGER NOT NULL DEFAULT 0,
    "context_summary" TEXT,
    "member_last_read_at" TIMESTAMPTZ(6),
    "staff_last_read_at" TIMESTAMPTZ(6),
    "satisfaction_rating" DOUBLE PRECISION,
    "satisfaction_comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_knowledge_articles" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "audience" "SupportAudience" NOT NULL DEFAULT 'MEMBER',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'vi',
    "content_markdown" TEXT NOT NULL,
    "status" "KnowledgeArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "KnowledgeSource" NOT NULL DEFAULT 'MANUAL',
    "source_ref" VARCHAR(255),
    "version" INTEGER NOT NULL DEFAULT 1,
    "content_hash" VARCHAR(64),
    "index_status" "KnowledgeIndexStatus" NOT NULL DEFAULT 'PENDING',
    "index_error" TEXT,
    "indexed_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_knowledge_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_knowledge_chunks" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "heading" VARCHAR(500) NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "embedding" vector(768),
    "embedding_model" VARCHAR(100) NOT NULL,
    "embedding_model_version" VARCHAR(50),
    "content_hash" VARCHAR(64) NOT NULL,

    CONSTRAINT "support_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_type" "SupportSenderType" NOT NULL,
    "sender_id" UUID,
    "content" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "client_message_id" VARCHAR(100),
    "reply_to_message_id" UUID,
    "ai_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_conversations_status_priority_escalated_at_idx" ON "support_conversations"("status", "priority", "escalated_at");

-- CreateIndex
CREATE INDEX "support_conversations_member_id_status_last_message_at_idx" ON "support_conversations"("member_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "support_conversations_assigned_agent_id_status_idx" ON "support_conversations"("assigned_agent_id", "status");

-- CreateIndex
CREATE INDEX "support_knowledge_articles_status_locale_audience_idx" ON "support_knowledge_articles"("status", "locale", "audience");

-- CreateIndex
CREATE UNIQUE INDEX "support_knowledge_articles_slug_locale_key" ON "support_knowledge_articles"("slug", "locale");

-- CreateIndex
CREATE INDEX "support_knowledge_chunks_embedding_model_idx" ON "support_knowledge_chunks"("embedding_model");

-- CreateIndex
CREATE UNIQUE INDEX "support_knowledge_chunks_article_id_chunk_index_key" ON "support_knowledge_chunks"("article_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_reply_to_message_id_key" ON "support_messages"("reply_to_message_id");

-- CreateIndex
CREATE INDEX "support_messages_conversation_id_created_at_idx" ON "support_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_conversation_id_client_message_id_key" ON "support_messages"("conversation_id", "client_message_id");

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_knowledge_articles" ADD CONSTRAINT "support_knowledge_articles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_knowledge_articles" ADD CONSTRAINT "support_knowledge_articles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_knowledge_chunks" ADD CONSTRAINT "support_knowledge_chunks_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "support_knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
