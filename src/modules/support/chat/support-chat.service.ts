import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  SupportConversation,
  SupportEscalationReason,
  SupportMessage,
  SupportSenderType,
  SupportStatus,
} from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { SupportAgentService, type SupportAgentReply } from '../ai/support-agent.service';
import { SupportAiUnavailableError } from '../ai/ai-errors';
import { SummaryService } from '../ai/summary.service';
import { RetrievalService } from '../knowledge/retrieval.service';
import { SupportRecipientsService } from '../staff/support-recipients.service';
import { SUPPORT_QUICK_REPLY, type SupportQuickReply } from '../shared/support-status';
import type { SupportConversationView, SupportSendResult } from '../shared/support-view';
import { EscalationService } from './escalation.service';
import { ResolutionService } from './resolution.service';
import { SupportConversationService } from './support-conversation.service';
import { SupportMessageService } from './support-message.service';
import { SupportTurnLockService } from './support-turn-lock.service';

export interface SendSupportMessageInput {
  content?: string;
  clientMessageId?: string;
}

@Injectable()
export class SupportChatService {
  private readonly logger = new Logger(SupportChatService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly conversations: SupportConversationService,
    private readonly messages: SupportMessageService,
    private readonly agent: SupportAgentService,
    private readonly escalation: EscalationService,
    private readonly resolution: ResolutionService,
    private readonly turnLock: SupportTurnLockService,
    private readonly retrieval: RetrievalService,
    private readonly summary: SummaryService,
    private readonly settings: PlatformSettingService,
    private readonly recipients: SupportRecipientsService,
    private readonly audit: AuditLogService,
  ) {}

  /** POST /support/conversations: reuses the member's open case. */
  async start(memberId: string): Promise<SupportConversationView> {
    const { conversation, created } = await this.conversations.openForMember(memberId);
    if (created) {
      await this.audit.record({
        action: CONTENT_EVENT.SUPPORT_CONVERSATION_CREATED,
        entityType: 'SupportConversation',
        entityId: conversation.id,
        projectId: null,
        actorId: memberId,
      });
    }
    return conversationView(conversation);
  }

  async listMine(memberId: string, query: PaginateQuery) {
    const page = await paginate(query, this.prisma.supportConversation, {
      where: { memberId },
      sortableColumns: ['createdAt', 'lastMessageAt'],
      defaultSortBy: [['lastMessageAt', 'DESC']],
      filterableColumns: { status: ['$eq', '$in'] },
    });
    return { ...page, data: page.data.map(conversationView) };
  }

  async detail(memberId: string, conversationId: string) {
    const conversation = await this.conversations.findOwned(conversationId, memberId);
    const messages = await this.messages.listForConversation(conversationId, { limit: 50 });
    await this.conversations.markRead(conversationId, 'member');
    return {
      conversation: conversationView(conversation),
      messages: messages.reverse().map(messageView),
      quickReplies: quickRepliesFor(conversation),
    };
  }

  /** Cursor page of older messages: `before` is the createdAt of the oldest message on screen. */
  async listMessages(memberId: string, conversationId: string, before?: string, limit = 30) {
    await this.conversations.findOwned(conversationId, memberId);
    const size = Math.min(Math.max(limit, 1), 100);
    const rows = await this.messages.listForConversation(conversationId, {
      limit: size + 1,
      before: before ? new Date(before) : undefined,
    });
    const hasMore = rows.length > size;
    const page = rows.slice(0, size).reverse();
    return {
      messages: page.map(messageView),
      hasMore,
      nextBefore: hasMore && page.length ? page[0].createdAt.toISOString() : null,
    };
  }

  /**
   * POST /support/conversations/:id/messages. The member's message is stored before the AI is
   * asked, so a provider outage never loses it; a failed turn either retries on the next message
   * or escalates after two consecutive failures. `clientMessageId` makes a retry idempotent.
   */
  async send(memberId: string, conversationId: string, input: SendSupportMessageInput): Promise<SupportSendResult> {
    const content = (input.content ?? '').trim();
    if (!content) throw new BadRequestException('Message content is required');
    if (content.length > this.config.support.messageMaxChars) {
      throw new BadRequestException(`A message may be at most ${this.config.support.messageMaxChars} characters`);
    }

    const conversation = await this.conversations.findOwned(conversationId, memberId);
    if (conversation.status === SupportStatus.CLOSED) {
      throw new ConflictException('This support conversation is closed; start a new one');
    }
    if (conversation.status === SupportStatus.RESOLVED) {
      throw new ConflictException('This support conversation has been resolved and is waiting for Staff to close it');
    }

    await this.assertDailyQuota(memberId);

    if (input.clientMessageId) {
      const existing = await this.messages.findByClientMessageId(conversationId, input.clientMessageId);
      if (existing) return this.replay(conversation, existing);
    }

    const memberMessage = await this.prisma.$transaction(async (tx) => {
      const created = await this.messages.create(
        {
          conversationId,
          senderType: SupportSenderType.MEMBER,
          senderId: memberId,
          content,
          clientMessageId: input.clientMessageId ?? null,
        },
        tx,
      );
      await this.conversations.touchMessages(conversationId, SupportSenderType.MEMBER, created.createdAt, tx);
      return created;
    });

    const current = await this.conversations.findById(conversationId);

    // Handed to Staff: the message is a normal inbox message, no AI answer.
    if (current.status !== SupportStatus.AI_HANDLING) {
      await this.recipients.notifyMemberReply(current, content);
      return {
        conversation: conversationView(current),
        memberMessage: messageView(memberMessage),
        aiMessage: null,
        systemMessage: null,
        quickReplies: [],
      };
    }

    const claimed = await this.turnLock.claim(conversationId);
    if (!claimed) {
      // Another request is already answering this conversation; this message waits for Staff.
      return {
        conversation: conversationView(current),
        memberMessage: messageView(memberMessage),
        aiMessage: null,
        systemMessage: null,
        quickReplies: quickRepliesFor(current),
      };
    }

    try {
      return await this.runAiTurn(memberId, conversationId, content, memberMessage);
    } finally {
      await this.turnLock.release(conversationId);
    }
  }

  private async runAiTurn(
    memberId: string,
    conversationId: string,
    content: string,
    memberMessage: SupportMessage,
  ): Promise<SupportSendResult> {
    const history = await this.messages.recentForAi(conversationId, this.config.support.aiHistoryMessages);
    const query = history
      .slice(-3)
      .map((message) => message.content)
      .join('\n');

    const [retrieved, platformFacts] = await Promise.all([
      this.retrieval.retrieve(query, {
        topK: this.config.support.ragTopK,
        minScore: this.config.support.ragMinScore,
        audience: 'MEMBER',
      }),
      this.platformFacts(),
    ]);

    let reply: SupportAgentReply;
    try {
      reply = await this.agent.reply({
        conversationId,
        memberId,
        message: content,
        history: history.map(({ senderType, content: line }) => ({ senderType, content: line })),
        platformFacts,
        retrieved,
      });
    } catch (error) {
      if (error instanceof SupportAiUnavailableError) {
        return this.escalateAfterAiFailure(conversationId, memberMessage, history, error.cause);
      }
      const failures = await this.conversations.recordAiFailure(conversationId);
      // Provider errors are logged by request shape only, never their content (plan §8.2).
      this.logger.warn(`AI turn failed on conversation ${conversationId} (failure ${failures})`);
      if (failures >= 2) {
        return this.escalateAfterAiFailure(conversationId, memberMessage, history, 'PROVIDER_ERROR');
      }
      return {
        conversation: conversationView(await this.conversations.findById(conversationId)),
        memberMessage: messageView(memberMessage),
        aiMessage: null,
        systemMessage: null,
        quickReplies: quickRepliesFor(await this.conversations.findById(conversationId)),
      };
    }

    const aiMessage = await this.messages.create({
      conversationId,
      senderType: SupportSenderType.AI_CHATBOT,
      senderId: null,
      // Plan §5.5: redact secrets after guardrails inspected the raw text, before persist/send.
      content: this.summary.redact(reply.reply),
      replyToMessageId: memberMessage.id,
      aiMetadata: {
        ...reply.metadata,
        confidence: reply.confidence,
        resolution: reply.resolution,
      } as unknown as Prisma.InputJsonValue,
    });

    await this.conversations.recordAiTurn(conversationId, {
      suggestedResolution: reply.resolution === 'RESOLVED_SUGGESTED',
    });

    if (reply.resolution === 'NEEDS_HUMAN' || reply.resolution === 'UNCERTAIN') {
      const summary = this.handoffSummary(
        reply.handoffSummary,
        history,
        reply.escalationReason ?? SupportEscalationReason.STAFF_NEEDED,
      );
      const escalated = await this.escalation.escalate({
        conversationId,
        reason: reply.escalationReason ?? SupportEscalationReason.STAFF_NEEDED,
        note: summary,
        summary,
        actorId: null,
      });
      return {
        conversation: conversationView(escalated.conversation),
        memberMessage: messageView(memberMessage),
        aiMessage: messageView(aiMessage),
        systemMessage: escalated.systemMessage ? messageView(escalated.systemMessage) : null,
        quickReplies: reply.quickReplies,
      };
    }

    const current = await this.conversations.findById(conversationId);
    return {
      conversation: conversationView(current),
      memberMessage: messageView(memberMessage),
      aiMessage: messageView(aiMessage),
      systemMessage: null,
      quickReplies: reply.quickReplies.length ? reply.quickReplies : quickRepliesFor(current),
    };
  }

  /** Member tapped "Đã giải quyết": the server performs the CLOSED transition. */
  async confirmResolved(memberId: string, conversationId: string, rating?: number, comment?: string) {
    await this.conversations.findOwned(conversationId, memberId);
    const conversation = await this.resolution.aiResolved(conversationId, memberId);
    if (rating !== undefined || comment !== undefined) {
      await this.prisma.supportConversation.update({
        where: { id: conversationId },
        data: {
          ...(rating !== undefined ? { satisfactionRating: rating } : {}),
          ...(comment !== undefined ? { satisfactionComment: comment } : {}),
        },
      });
      return conversationView(await this.conversations.findById(conversationId));
    }
    return conversationView(conversation);
  }

  /** Member asks for a human, without waiting for the AI to decide. */
  async requestStaff(memberId: string, conversationId: string, note?: string) {
    const conversation = await this.conversations.findOwned(conversationId, memberId);
    if (conversation.status === SupportStatus.CLOSED || conversation.status === SupportStatus.RESOLVED) {
      throw new ConflictException('This support conversation is no longer open');
    }
    const history = await this.messages.recentForAi(conversationId, this.config.support.aiHistoryMessages);
    const summary = this.handoffSummary(undefined, history, SupportEscalationReason.MEMBER_REQUEST, note);

    const escalated = await this.escalation.escalate({
      conversationId,
      reason: SupportEscalationReason.MEMBER_REQUEST,
      note: note ?? 'Thành viên yêu cầu được nhân viên hỗ trợ.',
      summary,
      actorId: memberId,
    });
    return {
      conversation: conversationView(escalated.conversation),
      systemMessage: escalated.systemMessage ? messageView(escalated.systemMessage) : null,
    };
  }

  async close(memberId: string, conversationId: string, note?: string) {
    await this.conversations.findOwned(conversationId, memberId);
    return conversationView(await this.resolution.memberClose(conversationId, memberId, note));
  }

  async markRead(memberId: string, conversationId: string) {
    await this.conversations.findOwned(conversationId, memberId);
    await this.conversations.markRead(conversationId, 'member');
  }

  private async replay(conversation: SupportConversation, memberMessage: SupportMessage): Promise<SupportSendResult> {
    const [current, aiMessage] = await Promise.all([
      this.conversations.findById(conversation.id),
      this.messages.findAiReply(memberMessage.id),
    ]);
    return {
      conversation: conversationView(current),
      memberMessage: messageView(memberMessage),
      aiMessage: aiMessage ? messageView(aiMessage) : null,
      systemMessage: null,
      quickReplies: quickRepliesFor(current),
    };
  }

  private async escalateAfterAiFailure(
    conversationId: string,
    memberMessage: SupportMessage,
    history: SupportMessage[],
    cause: string,
  ): Promise<SupportSendResult> {
    await this.conversations.recordAiFailure(conversationId);
    const note = `Trợ lý AI không thể trả lời (${cause}).`;
    const summary = this.handoffSummary(undefined, history, SupportEscalationReason.AI_UNAVAILABLE, note);
    const escalated = await this.escalation.escalate({
      conversationId,
      reason: SupportEscalationReason.AI_UNAVAILABLE,
      note,
      summary,
      actorId: null,
    });

    return {
      conversation: conversationView(escalated.conversation),
      memberMessage: messageView(memberMessage),
      aiMessage: null,
      systemMessage: escalated.systemMessage ? messageView(escalated.systemMessage) : null,
      quickReplies: [],
    };
  }

  private handoffSummary(
    provided: string | undefined,
    history: SupportMessage[],
    reason: SupportEscalationReason,
    note?: string,
  ): string {
    const summary =
      provided ??
      this.summary.fromTranscript({
        messages: history,
        reason: note ?? escalationText(reason),
        verifiedFacts: {},
        steps: [],
      });
    return this.summary.redact(summary);
  }

  /** Live facts in the prompt (plan §4.6); never a value the AI can write back. */
  private async platformFacts(): Promise<Record<string, unknown>> {
    const settings = await this.settings.get();
    return {
      coinRateVnd: settings.coinRateVnd,
      bonusCoinExpiryDays: settings.bonusCoinExpiryDays,
      coinTopUpMinVnd: settings.coinTopUpMinVnd,
      coinTopUpMaxVnd: settings.coinTopUpMaxVnd,
      subscriptionCancelWindowHours: settings.subscriptionCancelWindowHours,
      freeStarterEpisodeCount: settings.freeStarterEpisodeCount,
      refundOnRemoval: settings.refundOnRemoval,
    };
  }

  private async assertDailyQuota(memberId: string): Promise<void> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const used = await this.messages.countMemberMessagesSince(memberId, since);
    if (used >= this.config.support.dailyMessageLimit) {
      throw new HttpException(
        `You have reached the daily support message limit of ${this.config.support.dailyMessageLimit}`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

export function conversationView(conversation: SupportConversation): SupportConversationView {
  return {
    id: conversation.id,
    status: conversation.status,
    priority: conversation.priority,
    escalationReason: conversation.escalationReason,
    aiSummary: conversation.aiSummary,
    lastMessageAt: conversation.lastMessageAt,
    lastMemberMessageAt: conversation.lastMemberMessageAt,
    lastStaffMessageAt: conversation.lastStaffMessageAt,
    escalatedAt: conversation.escalatedAt,
    claimedAt: conversation.claimedAt,
    resolvedAt: conversation.resolvedAt,
    closedAt: conversation.closedAt,
    closeReason: conversation.closeReason,
    aiResolutionSuggestedAt: conversation.aiResolutionSuggestedAt,
    satisfactionRating: conversation.satisfactionRating,
    satisfactionComment: conversation.satisfactionComment,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function messageView(message: SupportMessage) {
  return {
    id: message.id,
    senderType: message.senderType,
    content: message.content,
    isInternal: message.isInternal,
    clientMessageId: message.clientMessageId,
    replyToMessageId: message.replyToMessageId,
    aiMetadata: (message.aiMetadata as Record<string, unknown> | null) ?? null,
    createdAt: message.createdAt,
  };
}

function quickRepliesFor(conversation: SupportConversation): SupportQuickReply[] {
  if (conversation.status !== SupportStatus.AI_HANDLING) return [];
  return [SUPPORT_QUICK_REPLY.CONFIRM_RESOLVED, SUPPORT_QUICK_REPLY.REQUEST_STAFF];
}

function escalationText(reason: SupportEscalationReason): string {
  return {
    AI_UNAVAILABLE: 'Trợ lý AI tạm thời không phản hồi.',
    INSUFFICIENT_INFO: 'Không đủ thông tin để trả lời chắc chắn.',
    ACCOUNT_VERIFICATION: 'Cần xác minh thông tin tài khoản hoặc giao dịch.',
    MEMBER_REQUEST: 'Thành viên yêu cầu nhân viên hỗ trợ.',
    STAFF_NEEDED: 'Vấn đề vượt quá phạm vi tự xử lý của trợ lý AI.',
  }[reason];
}
