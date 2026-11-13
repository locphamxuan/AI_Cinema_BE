import { ConflictException, Injectable } from '@nestjs/common';
import {
  SupportConversation,
  SupportEscalationReason,
  SupportMessage,
  SupportPriority,
  SupportSenderType,
  SupportStatus,
} from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { ESCALATION_PRIORITY, ESCALATION_REASON_LABEL } from '../shared/support-reason';
import { SupportConversationService } from './support-conversation.service';
import { SupportMessageService } from './support-message.service';

export interface EscalateInput {
  conversationId: string;
  reason: SupportEscalationReason;
  /** Staff-facing detail: what was verified, what failed, what to try next. */
  note?: string;
  /** Snapshot for the Staff queue; falls back to the escalation note. */
  summary?: string;
  actorId?: string | null;
  /** Member-visible line; defaults to the standard hand-off sentence. */
  memberNotice?: string;
}

/**
 * AI_HANDLING → WAITING_FOR_STAFF (flow doc step 6). The transcript stays where it is; the
 * summary and the reason ride on the case so Staff never asks the member to start over.
 */
@Injectable()
export class EscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: SupportConversationService,
    private readonly messages: SupportMessageService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  async escalate(input: EscalateInput): Promise<{
    conversation: SupportConversation;
    systemMessage: SupportMessage | null;
  }> {
    const conversation = await this.conversations.findById(input.conversationId);

    if (conversation.status === SupportStatus.CLOSED || conversation.status === SupportStatus.RESOLVED) {
      throw new ConflictException('A resolved or closed support case cannot be escalated');
    }
    // Already handed over: repeated "request staff" taps are a no-op.
    if (
      conversation.status === SupportStatus.WAITING_FOR_STAFF ||
      conversation.status === SupportStatus.STAFF_HANDLING
    ) {
      return { conversation, systemMessage: null };
    }

    const now = new Date();
    const priority = higherPriority(conversation.priority, ESCALATION_PRIORITY[input.reason]);
    const memberNotice =
      input.memberNotice ??
      `Yêu cầu của bạn đã được chuyển đến nhân viên hỗ trợ. Nhân viên sẽ xem lại cuộc hội thoại này và phản hồi bạn sớm nhất có thể.`;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await this.conversations.transition(
        conversation.id,
        SupportStatus.AI_HANDLING,
        SupportStatus.WAITING_FOR_STAFF,
        {
          escalationReason: input.reason,
          escalationNote: input.note ?? null,
          aiSummary: input.summary ?? input.note ?? ESCALATION_REASON_LABEL[input.reason],
          escalatedAt: now,
          priority,
          assignedAgentId: null,
          claimedAt: null,
        },
        tx,
      );

      const systemMessage = await this.messages.create(
        {
          conversationId: conversation.id,
          senderType: SupportSenderType.SYSTEM,
          content: memberNotice,
          isInternal: false,
        },
        tx,
      );

      // Internal trail for Staff: reason + note, never shown to the member.
      await this.messages.create(
        {
          conversationId: conversation.id,
          senderType: SupportSenderType.SYSTEM,
          content: `[ESCALATED ${input.reason}] ${input.note ?? ESCALATION_REASON_LABEL[input.reason]}`,
          isInternal: true,
        },
        tx,
      );

      await this.audit.record(
        {
          action: CONTENT_EVENT.SUPPORT_CASE_ESCALATED,
          entityType: 'SupportConversation',
          entityId: conversation.id,
          projectId: null,
          actorId: input.actorId ?? null,
          payload: { reason: input.reason, priority },
        },
        tx,
      );

      return { conversation: updated, systemMessage };
    });

    await this.notifyStaff(conversation.memberId, conversation.id, input.reason);
    return result;
  }

  private async notifyStaff(memberId: string, conversationId: string, reason: SupportEscalationReason) {
    const staff = await this.prisma.user.findMany({
      where: { role: { in: ['STAFF', 'ADMIN'] }, isActive: true },
      select: { id: true },
    });
    await this.notifications.notify(
      staff.map(({ id }) => id),
      {
        type: NOTIFICATION_TYPE.SUPPORT_CASE_ESCALATED,
        title: 'Có support case mới cần xử lý',
        body: ESCALATION_REASON_LABEL[reason],
        link: `/admin/support/conversations/${conversationId}`,
        payload: { conversationId, memberId, reason },
      },
    );
  }
}

const PRIORITY_ORDER: Record<SupportPriority, number> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  URGENT: 3,
};

function higherPriority(a: SupportPriority, b: SupportPriority): SupportPriority {
  return PRIORITY_ORDER[b] > PRIORITY_ORDER[a] ? b : a;
}
