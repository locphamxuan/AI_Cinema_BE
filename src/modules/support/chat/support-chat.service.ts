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
import { SupportRecipientsService } from '../staff/support-recipients.service';
import type { SupportConversationView, SupportSendResult } from '../shared/support-view';
import { conversationView, messageView, quickRepliesFor } from '../shared/support-presenter';
import { EscalationService } from './escalation.service';
import { SupportAiTurnService } from './support-ai-turn.service';
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
    private readonly aiTurn: SupportAiTurnService,
    private readonly escalation: EscalationService,
    private readonly resolution: ResolutionService,
    private readonly turnLock: SupportTurnLockService,
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
      return await this.aiTurn.run(memberId, conversationId, content, memberMessage);
    } finally {
      await this.turnLock.release(conversationId);
    }
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
    const summary = this.aiTurn.handoffSummary(undefined, history, SupportEscalationReason.MEMBER_REQUEST, note);

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
