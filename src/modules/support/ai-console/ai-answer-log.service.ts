import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SupportAiFeedback, SupportSenderType } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';

const AI_ANSWER = {
  senderType: SupportSenderType.AI_CHATBOT,
  isInternal: false,
} satisfies Prisma.SupportMessageWhereInput;

interface AnswerRow {
  id: string;
  conversationId: string;
  content: string;
  replyToMessageId: string | null;
  aiMetadata: Prisma.JsonValue;
  aiFeedback: SupportAiFeedback | null;
  aiFeedbackNote: string | null;
  aiFeedbackAt: Date | null;
  createdAt: Date;
  conversation: unknown;
  aiFeedbackBy: { id: string; fullName: string } | null;
}

interface StoredMetadata {
  confidence?: number;
  resolution?: string;
  model?: string;
  sources?: Array<{ articleId: string; title: string; heading: string }>;
  toolCalls?: Array<{ name: string }>;
}

interface SummaryRow {
  total: bigint;
  helpful: bigint;
  not_helpful: bigint;
  handed_off: bigint;
  avg_rating: number | null;
}

/**
 * Chat logs of the Admin AI console: every answer the AI gave a member, next to the question it answered, and
 * the Admin's verdict on it. NOT_HELPFUL answers point at the articles the Knowledge Base still lacks.
 */
@Injectable()
export class AiAnswerLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async list(query: PaginateQuery) {
    const page = await paginate(query, this.prisma.supportMessage, {
      where: AI_ANSWER,
      relations: {
        conversation: {
          select: {
            id: true,
            status: true,
            satisfactionRating: true,
            member: { select: { id: true, fullName: true, email: true } },
          },
        },
        aiFeedbackBy: { select: { id: true, fullName: true } },
      },
      sortableColumns: ['createdAt'],
      defaultSortBy: [['createdAt', 'DESC']],
      searchableColumns: ['content'],
      filterableColumns: {
        aiFeedback: ['$eq', '$in', '$null'],
        conversationId: ['$eq'],
        createdAt: ['$gte', '$lte'],
      },
    });
    const rows = page.data as unknown as AnswerRow[];
    const questionIds = rows.map((row) => row.replyToMessageId).filter((id): id is string => !!id);
    const questions = questionIds.length
      ? await this.prisma.supportMessage.findMany({
          where: { id: { in: questionIds } },
          select: { id: true, content: true },
        })
      : [];
    const questionOf = new Map(questions.map((q) => [q.id, q.content]));
    return { ...page, data: rows.map((row) => this.present(row, questionOf)) };
  }

  /** Counters above the log: how many answers were rated, and how many the AI handed to Staff. */
  async summary() {
    const [row] = await this.prisma.$queryRaw<SummaryRow[]>`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE m.ai_feedback = 'HELPFUL') AS helpful,
             count(*) FILTER (WHERE m.ai_feedback = 'NOT_HELPFUL') AS not_helpful,
             count(*) FILTER (WHERE m.ai_metadata->>'resolution' IN ('NEEDS_HUMAN', 'UNCERTAIN')) AS handed_off,
             (SELECT avg(c.satisfaction_rating)::float FROM support_conversations c
               WHERE c.satisfaction_rating IS NOT NULL) AS avg_rating
        FROM support_messages m
       WHERE m.sender_type = 'AI_CHATBOT' AND m.is_internal = false`;
    const total = Number(row?.total ?? 0);
    const helpful = Number(row?.helpful ?? 0);
    const notHelpful = Number(row?.not_helpful ?? 0);
    return {
      totalAnswers: total,
      helpful,
      notHelpful,
      unrated: total - helpful - notHelpful,
      handedOffToStaff: Number(row?.handed_off ?? 0),
      averageSatisfaction: row?.avg_rating ?? null,
    };
  }

  async rate(messageId: string, rating: SupportAiFeedback, note: string | undefined, adminId: string) {
    const message = await this.prisma.supportMessage.findUnique({
      where: { id: messageId },
      select: { id: true, senderType: true, isInternal: true },
    });
    if (!message) throw new NotFoundException('AI answer not found');
    if (message.senderType !== SupportSenderType.AI_CHATBOT || message.isInternal) {
      throw new ConflictException('Only an answer the AI gave a member can be rated');
    }
    const updated = await this.prisma.supportMessage.update({
      where: { id: messageId },
      data: {
        aiFeedback: rating,
        aiFeedbackNote: note?.trim() || null,
        aiFeedbackById: adminId,
        aiFeedbackAt: new Date(),
      },
      select: { id: true, aiFeedback: true, aiFeedbackNote: true, aiFeedbackAt: true },
    });
    await this.audit.record({
      action: CONTENT_EVENT.SUPPORT_AI_ANSWER_RATED,
      entityType: 'SupportMessage',
      entityId: messageId,
      projectId: null,
      actorId: adminId,
      payload: { rating },
    });
    return updated;
  }

  private present(row: AnswerRow, questionOf: Map<string, string>) {
    const meta = (row.aiMetadata ?? {}) as StoredMetadata;
    return {
      id: row.id,
      conversationId: row.conversationId,
      question: row.replyToMessageId ? (questionOf.get(row.replyToMessageId) ?? null) : null,
      answer: row.content,
      confidence: meta.confidence ?? null,
      resolution: meta.resolution ?? null,
      model: meta.model ?? null,
      sources: meta.sources ?? [],
      toolsUsed: (meta.toolCalls ?? []).map((call) => call.name),
      feedback: row.aiFeedback,
      feedbackNote: row.aiFeedbackNote,
      feedbackAt: row.aiFeedbackAt,
      feedbackBy: row.aiFeedbackBy,
      conversation: row.conversation,
      createdAt: row.createdAt,
    };
  }
}
