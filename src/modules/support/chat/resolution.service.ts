import { Injectable } from '@nestjs/common';
import { SupportCloseReason, SupportConversation, SupportSenderType, SupportStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { SupportConversationService } from './support-conversation.service';
import { SupportMessageService } from './support-message.service';

/**
 * The closing half of the lifecycle (plan §7). Closing never deletes the conversation: the
 * transcript stays readable in the member's support history.
 *
 * AI may only suggest a resolution; the member confirms, and the server does the closing.
 */
@Injectable()
export class ResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: SupportConversationService,
    private readonly messages: SupportMessageService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  /** Member tapped "Đã giải quyết" on an AI answer: AI_HANDLING → CLOSED (AI_RESOLVED). */
  aiResolved(conversationId: string, actorId: string): Promise<SupportConversation> {
    return this.close(
      conversationId,
      [SupportStatus.AI_HANDLING],
      SupportCloseReason.AI_RESOLVED,
      actorId,
      'Cảm ơn bạn đã xác nhận. Yêu cầu hỗ trợ đã được đóng.',
    );
  }

  /** Member closes their own case, whatever stage it is in. */
  memberClose(conversationId: string, memberId: string, note?: string): Promise<SupportConversation> {
    return this.close(
      conversationId,
      [SupportStatus.AI_HANDLING, SupportStatus.WAITING_FOR_STAFF, SupportStatus.STAFF_HANDLING],
      SupportCloseReason.MEMBER_CLOSED,
      memberId,
      note ? `Bạn đã đóng yêu cầu hỗ trợ: ${note}` : 'Bạn đã đóng yêu cầu hỗ trợ.',
    );
  }

  /** Staff finished the work: STAFF_HANDLING → RESOLVED (a final close follows). */
  async staffResolve(conversationId: string, staffId: string, note?: string): Promise<SupportConversation> {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await this.conversations.transition(
        conversationId,
        SupportStatus.STAFF_HANDLING,
        SupportStatus.RESOLVED,
        { resolvedAt: now, resolutionNote: note ?? null },
        tx,
      );
      const systemMessage = await this.messages.create(
        {
          conversationId,
          senderType: SupportSenderType.SYSTEM,
          content: note ? `Nhân viên đã xử lý yêu cầu của bạn: ${note}` : 'Nhân viên đã xử lý yêu cầu của bạn.',
          isInternal: false,
        },
        tx,
      );
      await this.audit.record(
        {
          action: CONTENT_EVENT.SUPPORT_CASE_RESOLVED,
          entityType: 'SupportConversation',
          entityId: conversationId,
          projectId: null,
          actorId: staffId,
        },
        tx,
      );
      return { conversation: updated, systemMessage };
    });
    await this.notifications.notify([result.conversation.memberId], {
      type: NOTIFICATION_TYPE.SUPPORT_CASE_CLOSED,
      title: 'Yêu cầu hỗ trợ đã được xử lý',
      body: note ?? 'Nhân viên đã xử lý xong yêu cầu hỗ trợ của bạn.',
      link: `/support/conversations/${conversationId}`,
      payload: { conversationId, status: SupportStatus.RESOLVED },
    });
    return result.conversation;
  }

  /** Staff final step: RESOLVED (or STAFF_HANDLING) → CLOSED (STAFF_RESOLVED). */
  staffClose(conversationId: string, staffId: string, note?: string): Promise<SupportConversation> {
    return this.close(
      conversationId,
      [SupportStatus.RESOLVED, SupportStatus.STAFF_HANDLING],
      SupportCloseReason.STAFF_RESOLVED,
      staffId,
      note ?? 'Nhân viên đã đóng yêu cầu hỗ trợ. Cảm ơn bạn đã liên hệ.',
      note,
    );
  }

  private async close(
    conversationId: string,
    from: SupportStatus[],
    closeReason: SupportCloseReason,
    actorId: string,
    memberNotice: string,
    resolutionNote?: string,
  ): Promise<SupportConversation> {
    const now = new Date();
    const conversation = await this.prisma.$transaction(async (tx) => {
      const current = await this.conversations.findById(conversationId, tx);
      const updated = await this.conversations.transition(
        conversationId,
        from,
        SupportStatus.CLOSED,
        {
          closedAt: now,
          resolvedAt: current.resolvedAt ?? now,
          closeReason,
          ...(resolutionNote !== undefined ? { resolutionNote } : {}),
        },
        tx,
      );

      await this.messages.create(
        {
          conversationId,
          senderType: SupportSenderType.SYSTEM,
          content: memberNotice,
          isInternal: false,
        },
        tx,
      );

      await this.audit.record(
        {
          action: CONTENT_EVENT.SUPPORT_CASE_CLOSED,
          entityType: 'SupportConversation',
          entityId: conversationId,
          projectId: null,
          actorId,
          payload: { closeReason },
        },
        tx,
      );
      return updated;
    });

    await this.notifications.notify([conversation.memberId], {
      type: NOTIFICATION_TYPE.SUPPORT_CASE_CLOSED,
      title: 'Yêu cầu hỗ trợ đã đóng',
      body: memberNotice,
      link: `/support/conversations/${conversationId}`,
      payload: { conversationId, closeReason },
    });

    return conversation;
  }
}
