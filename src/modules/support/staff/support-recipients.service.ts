import { Injectable } from '@nestjs/common';
import { SupportConversation } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';

type CaseOwner = Pick<SupportConversation, 'id' | 'memberId' | 'assignedAgentId'>;

/**
 * Who hears about a support case (plan §3.5): the assigned Staff when there is one, otherwise
 * every active Staff and Admin. Used for the member-replied alert; escalation has its own copy
 * because it runs inside the escalation transaction's lifecycle.
 */
@Injectable()
export class SupportRecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** Active Staff and Admins, the audience of an unassigned case. */
  async staffIds(): Promise<string[]> {
    const staff = await this.prisma.user.findMany({
      where: { role: { in: ['STAFF', 'ADMIN'] }, isActive: true },
      select: { id: true },
    });
    return staff.map(({ id }) => id);
  }

  async caseStaffIds(conversation: CaseOwner): Promise<string[]> {
    return conversation.assignedAgentId ? [conversation.assignedAgentId] : this.staffIds();
  }

  /** Tells Staff the member wrote again on a case they handed over. */
  async notifyMemberReply(conversation: CaseOwner, preview: string): Promise<void> {
    await this.notifications.notify(await this.caseStaffIds(conversation), {
      type: NOTIFICATION_TYPE.SUPPORT_MEMBER_REPLIED,
      title: 'Thành viên vừa phản hồi yêu cầu hỗ trợ',
      body: truncate(preview, 200),
      link: `/admin/support/conversations/${conversation.id}`,
      payload: { conversationId: conversation.id, memberId: conversation.memberId },
    });
  }

  /** Tells one Staff member an Admin assigned a case to them. */
  async notifyAssigned(conversation: CaseOwner, staffId: string): Promise<void> {
    await this.notifications.notify([staffId], {
      type: NOTIFICATION_TYPE.SUPPORT_CASE_ASSIGNED,
      title: 'Bạn được giao một yêu cầu hỗ trợ',
      body: 'Mở hàng đợi hỗ trợ để xem chi tiết và phản hồi thành viên.',
      link: `/admin/support/conversations/${conversation.id}`,
      payload: { conversationId: conversation.id },
    });
  }
}

function truncate(value: string, max: number): string {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
