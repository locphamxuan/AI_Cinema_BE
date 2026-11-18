import { Injectable } from '@nestjs/common';
import { SupportCloseReason, SupportConversation, SupportSenderType, SupportStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { SupportConversationService } from './support-conversation.service';
import { SupportMessageService } from './support-message.service';

/** What the member is told once Staff marks the case resolved: how it ends from there. */
export const RESOLVED_HINT =
  'Chọn "Đã giải quyết" để đóng, hoặc "Vẫn cần hỗ trợ" để nhân viên xử lý tiếp; yêu cầu tự đóng nếu bạn không phản hồi.';

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

  /** Member confirms the work Staff marked resolved: RESOLVED → CLOSED (STAFF_RESOLVED). */
  staffResolutionConfirmed(conversationId: string, memberId: string): Promise<SupportConversation> {
    return this.close(
      conversationId,
      [SupportStatus.RESOLVED],
      SupportCloseReason.STAFF_RESOLVED,
      memberId,
      'Cảm ơn bạn đã xác nhận. Yêu cầu hỗ trợ đã được đóng.',
    );
  }

  /** Member says the problem is not solved: RESOLVED → WAITING_FOR_STAFF, back in the Staff queue. */
  reopen(conversationId: string, memberId: string): Promise<{ conversation: SupportConversation; changed: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await this.conversations.move(
        conversationId,
        SupportStatus.RESOLVED,
        SupportStatus.WAITING_FOR_STAFF,
        { resolvedAt: null, assignedAgentId: null },
        tx,
      );
      if (!moved.changed) return moved;
      await this.messages.create(
        {
          conversationId,
          senderType: SupportSenderType.SYSTEM,
          content: 'Bạn cho biết vẫn cần hỗ trợ. Yêu cầu đã được chuyển lại cho nhân viên.',
          isInternal: false,
        },
        tx,
      );
      await this.audit.record(
        {
          action: CONTENT_EVENT.SUPPORT_CASE_ESCALATED,
          entityType: 'SupportConversation',
          entityId: conversationId,
          projectId: null,
          actorId: memberId,
          payload: { reopened: true },
        },
        tx,
      );
      return moved;
    });
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
      // A repeated or concurrent resolve finds the case already RESOLVED (changed: false) and
      // writes nothing more: no second message, audit row or notice.
      const { conversation: updated, changed } = await this.conversations.move(
        conversationId,
        SupportStatus.STAFF_HANDLING,
        SupportStatus.RESOLVED,
        { resolvedAt: now, resolutionNote: note ?? null },
        tx,
      );
      if (!changed) return { conversation: updated, replayed: true };
      const systemMessage = await this.messages.create(
        {
          conversationId,
          senderType: SupportSenderType.SYSTEM,
          content: `${note ? `Nhân viên đã xử lý yêu cầu của bạn: ${note}` : 'Nhân viên đã xử lý yêu cầu của bạn.'} ${RESOLVED_HINT}`,
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
      return { conversation: updated, systemMessage, replayed: false };
    });
    if (result.replayed) return result.conversation;
    await this.notifications.notify([result.conversation.memberId], {
      type: NOTIFICATION_TYPE.SUPPORT_CASE_CLOSED,
      title: 'Yêu cầu hỗ trợ đã được xử lý',
      body: note ?? 'Nhân viên đã xử lý xong yêu cầu hỗ trợ của bạn.',
      link: `/support/conversations/${conversationId}`,
      payload: { conversationId, status: SupportStatus.RESOLVED },
    });
    return result.conversation;
  }

  private async close(
    conversationId: string,
    from: SupportStatus[],
    closeReason: SupportCloseReason,
    actorId: string,
    memberNotice: string,
  ): Promise<SupportConversation> {
    const now = new Date();
    const { conversation, replayed } = await this.prisma.$transaction(async (tx) => {
      const current = await this.conversations.findById(conversationId, tx);
      // Closing a case twice (double tap, a concurrent request, or the auto-close sweep got there
      // first) is a no-op: the guarded move reports changed: false and nothing more is written.
      if (current.status === SupportStatus.CLOSED) return { conversation: current, replayed: true };
      const { conversation: updated, changed } = await this.conversations.move(
        conversationId,
        from,
        SupportStatus.CLOSED,
        {
          closedAt: now,
          resolvedAt: current.resolvedAt ?? now,
          closeReason,
        },
        tx,
      );
      if (!changed) return { conversation: updated, replayed: true };

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
      return { conversation: updated, replayed: false };
    });
    if (replayed) return conversation;

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
