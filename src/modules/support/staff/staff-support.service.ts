import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SupportCloseReason,
  SupportConversation,
  SupportEscalationReason,
  SupportMessage,
  SupportSenderType,
  SupportStatus,
} from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { SupportConversationService } from '../chat/support-conversation.service';
import { SupportMessageService } from '../chat/support-message.service';
import { ResolutionService } from '../chat/resolution.service';
import type { SupportStaffCaseView } from '../shared/support-view';
import { MemberContextService, type MemberContextSection } from './member-context.service';
import { SupportRecipientsService } from './support-recipients.service';

const CASE_RELATIONS = {
  member: { select: { id: true, fullName: true } },
  assignedAgent: { select: { id: true, fullName: true } },
} satisfies Prisma.SupportConversationInclude;

type CaseRow = Prisma.SupportConversationGetPayload<{ include: typeof CASE_RELATIONS }>;

export interface StaffReplyInput {
  content?: string;
  isInternal?: boolean;
}

/**
 * The Staff side of a support case (plan A6.2): queue, claim/release/assign, reply, resolve and
 * close. Ownership is enforced here, not only by the route permission: a Staff member may only
 * work a case assigned to them unless the caller is an Admin.
 */
@Injectable()
export class StaffSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: SupportConversationService,
    private readonly messages: SupportMessageService,
    private readonly resolution: ResolutionService,
    private readonly recipients: SupportRecipientsService,
    private readonly memberContext: MemberContextService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  async list(query: PaginateQuery) {
    const page = await paginate(query, this.prisma.supportConversation, {
      relations: CASE_RELATIONS,
      sortableColumns: ['lastMessageAt', 'escalatedAt', 'priority', 'createdAt', 'updatedAt'],
      defaultSortBy: [['lastMessageAt', 'DESC']],
      filterableColumns: {
        status: ['$eq', '$in'],
        priority: ['$eq', '$in'],
        escalationReason: ['$eq', '$in'],
        assignedAgentId: ['$eq', '$null'],
        memberId: ['$eq'],
      },
    });
    return { ...page, data: page.data.map((row) => this.view(row as CaseRow)) };
  }

  async detail(id: string) {
    const conversation = await this.caseById(id);
    const messages = await this.messages.listForConversation(id, { limit: 100, includeInternal: true });
    await this.conversations.markRead(id, 'staff');
    return {
      conversation: this.view(conversation),
      messages: messages.reverse().map(messageView),
    };
  }

  /** WAITING_FOR_STAFF �+' STAFF_HANDLING; two Staff taps race, only one wins. */
  async claim(id: string, staffId: string): Promise<SupportStaffCaseView> {
    const conversation = await this.conversations.findById(id);

    if (conversation.status === SupportStatus.STAFF_HANDLING && conversation.assignedAgentId === staffId) {
      return this.view(await this.caseById(id));
    }
    if (conversation.status !== SupportStatus.WAITING_FOR_STAFF) {
      throw new ConflictException('Only a case waiting for Staff can be claimed');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.conversations.transition(
        id,
        SupportStatus.WAITING_FOR_STAFF,
        SupportStatus.STAFF_HANDLING,
        { assignedAgentId: staffId, claimedAt: new Date() },
        tx,
      );
      await this.audit.record(
        {
          action: CONTENT_EVENT.SUPPORT_CASE_CLAIMED,
          entityType: 'SupportConversation',
          entityId: id,
          projectId: null,
          actorId: staffId,
        },
        tx,
      );
    });

    return this.view(await this.caseById(id));
  }

  /** Returns a case to the queue; the assignee or an Admin may do it. */
  async release(id: string, user: AuthenticatedUser): Promise<SupportStaffCaseView> {
    const conversation = await this.conversations.findById(id);
    if (conversation.status === SupportStatus.WAITING_FOR_STAFF) return this.view(await this.caseById(id));
    if (conversation.status !== SupportStatus.STAFF_HANDLING) {
      throw new ConflictException('Only a case being handled by Staff can be released');
    }
    if (conversation.assignedAgentId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('Only the assigned Staff member or an Admin can release this case');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.conversations.transition(
        id,
        SupportStatus.STAFF_HANDLING,
        SupportStatus.WAITING_FOR_STAFF,
        { assignedAgentId: null, claimedAt: null },
        tx,
      );
      await this.audit.record(
        {
          action: CONTENT_EVENT.SUPPORT_CASE_RELEASED,
          entityType: 'SupportConversation',
          entityId: id,
          projectId: null,
          actorId: user.id,
        },
        tx,
      );
    });

    return this.view(await this.caseById(id));
  }

  /** Admin assignment: WAITING_FOR_STAFF or STAFF_HANDLING �+' STAFF_HANDLING with a new owner. */
  async assign(id: string, targetStaffId: string, adminId: string): Promise<SupportStaffCaseView> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetStaffId, role: { in: ['STAFF', 'ADMIN'] }, isActive: true },
      select: { id: true },
    });
    if (!target) throw new BadRequestException('The assignee must be an active Staff member');

    const conversation = await this.conversations.findById(id);
    if (
      conversation.status !== SupportStatus.WAITING_FOR_STAFF &&
      conversation.status !== SupportStatus.STAFF_HANDLING
    ) {
      throw new ConflictException('Only an open Staff case can be assigned');
    }

    const { count } = await this.prisma.supportConversation.updateMany({
      where: { id, status: { in: [SupportStatus.WAITING_FOR_STAFF, SupportStatus.STAFF_HANDLING] } },
      data: {
        status: SupportStatus.STAFF_HANDLING,
        assignedAgentId: targetStaffId,
        claimedAt: conversation.claimedAt ?? new Date(),
      },
    });
    if (count === 0) throw new ConflictException('The support case changed while assigning it');

    await this.audit.record({
      action: CONTENT_EVENT.SUPPORT_CASE_CLAIMED,
      entityType: 'SupportConversation',
      entityId: id,
      projectId: null,
      actorId: adminId,
      payload: { assignedTo: targetStaffId, assignedByAdmin: true },
    });
    await this.recipients.notifyAssigned(conversation, targetStaffId);

    return this.view(await this.caseById(id));
  }

  /**
   * Staff answer. Replying to a queued case claims it in the same transaction; an internal note
   * never bumps the member's transcript and never notifies them (plan A6.2).
   */
  async reply(id: string, user: AuthenticatedUser, input: StaffReplyInput = {}) {
    const content = (input.content ?? '').trim();
    if (!content) throw new BadRequestException('Message content is required');
    const isInternal = input.isInternal ?? false;

    const conversation = await this.conversations.findById(id);
    if (conversation.status === SupportStatus.CLOSED || conversation.status === SupportStatus.RESOLVED) {
      throw new ConflictException('A resolved or closed support case cannot receive new messages');
    }
    if (
      conversation.status === SupportStatus.STAFF_HANDLING &&
      conversation.assignedAgentId &&
      conversation.assignedAgentId !== user.id &&
      user.role !== 'ADMIN'
    ) {
      throw new ForbiddenException('This case is assigned to another Staff member');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      let current: SupportConversation = conversation;

      if (current.status === SupportStatus.WAITING_FOR_STAFF) {
        current = await this.conversations.transition(
          id,
          SupportStatus.WAITING_FOR_STAFF,
          SupportStatus.STAFF_HANDLING,
          { assignedAgentId: current.assignedAgentId ?? user.id, claimedAt: current.claimedAt ?? new Date() },
          tx,
        );
      }

      const created = await this.messages.create(
        {
          conversationId: id,
          senderType: SupportSenderType.SUPPORT_AGENT,
          senderId: user.id,
          content,
          isInternal,
        },
        tx,
      );

      if (!isInternal)
        await this.conversations.touchMessages(id, SupportSenderType.SUPPORT_AGENT, created.createdAt, tx);
      if (!isInternal && !current.firstStaffReplyAt) {
        await tx.supportConversation.update({ where: { id }, data: { firstStaffReplyAt: created.createdAt } });
      }

      await this.audit.record(
        {
          action: CONTENT_EVENT.SUPPORT_AGENT_REPLIED,
          entityType: 'SupportConversation',
          entityId: id,
          projectId: null,
          actorId: user.id,
          payload: { internal: isInternal },
        },
        tx,
      );
      return created;
    });

    if (!isInternal) {
      const updated = await this.conversations.findById(id);
      await this.notifications.notify([updated.memberId], {
        type: NOTIFICATION_TYPE.SUPPORT_AGENT_REPLIED,
        title: 'NhA�n viA�n �`A� ph���n h��"i yA�u c��u h��- tr���',
        body: truncatePreview(content),
        link: `/support/conversations/${id}`,
        payload: { conversationId: id },
      });
    }

    return { conversation: this.view(await this.caseById(id)), message: messageView(message) };
  }

  async resolve(id: string, staffId: string, note?: string): Promise<SupportStaffCaseView> {
    await this.resolution.staffResolve(id, staffId, note);
    return this.view(await this.caseById(id));
  }

  async close(id: string, staffId: string, note?: string): Promise<SupportStaffCaseView> {
    await this.resolution.staffClose(id, staffId, note);
    return this.view(await this.caseById(id));
  }

  /** Plan A8.4 dashboard; the counts are of the whole platform, not one operator. */
  async stats() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWindow = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60_000);

    const [byStatus, oldestWaiting, escalatedToday, resolvedToday, closedWindow, closedByAi, reasons] =
      await Promise.all([
        this.prisma.supportConversation.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.supportConversation.findFirst({
          where: { status: SupportStatus.WAITING_FOR_STAFF },
          orderBy: { escalatedAt: 'asc' },
          select: { id: true, escalatedAt: true, createdAt: true, priority: true },
        }),
        this.prisma.supportConversation.count({ where: { escalatedAt: { gte: startOfToday } } }),
        this.prisma.supportConversation.count({ where: { resolvedAt: { gte: startOfToday } } }),
        this.prisma.supportConversation.count({
          where: { status: SupportStatus.CLOSED, closedAt: { gte: startOfWindow } },
        }),
        this.prisma.supportConversation.count({
          where: {
            status: SupportStatus.CLOSED,
            closeReason: SupportCloseReason.AI_RESOLVED,
            closedAt: { gte: startOfWindow },
          },
        }),
        this.prisma.supportConversation.groupBy({
          by: ['escalationReason'],
          where: { escalationReason: { not: null }, escalatedAt: { gte: startOfWindow } },
          _count: { _all: true },
        }),
      ]);

    const counts = Object.fromEntries(Object.values(SupportStatus).map((status) => [status, 0])) as Record<
      SupportStatus,
      number
    >;
    for (const row of byStatus) counts[row.status] = row._count._all;

    const waitingSince = oldestWaiting?.escalatedAt ?? oldestWaiting?.createdAt ?? null;

    return {
      byStatus: counts,
      waiting: counts[SupportStatus.WAITING_FOR_STAFF] ?? 0,
      oldestWaiting: oldestWaiting
        ? {
            conversationId: oldestWaiting.id,
            priority: oldestWaiting.priority,
            waitingMinutes: waitingSince ? Math.max(0, Math.round((Date.now() - waitingSince.getTime()) / 60_000)) : 0,
          }
        : null,
      escalatedToday,
      resolvedToday,
      aiResolvedRate: closedWindow ? Math.round((closedByAi / closedWindow) * 1000) / 1000 : 0,
      topEscalationReasons: reasons
        .filter((row): row is typeof row & { escalationReason: SupportEscalationReason } =>
          Boolean(row.escalationReason),
        )
        .map((row) => ({ reason: row.escalationReason, count: row._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }

  getMemberContext(id: string, user: AuthenticatedUser, section?: MemberContextSection) {
    return this.memberContext.getContext(id, user, section);
  }

  private async caseById(id: string): Promise<CaseRow> {
    const conversation = await this.prisma.supportConversation.findUnique({ where: { id }, include: CASE_RELATIONS });
    if (!conversation) throw new NotFoundException('Support conversation not found');
    return conversation;
  }

  private view(row: CaseRow): SupportStaffCaseView {
    return {
      id: row.id,
      status: row.status,
      priority: row.priority,
      escalationReason: row.escalationReason,
      aiSummary: row.aiSummary,
      lastMessageAt: row.lastMessageAt,
      lastMemberMessageAt: row.lastMemberMessageAt,
      lastStaffMessageAt: row.lastStaffMessageAt,
      escalatedAt: row.escalatedAt,
      claimedAt: row.claimedAt,
      resolvedAt: row.resolvedAt,
      closedAt: row.closedAt,
      closeReason: row.closeReason,
      aiResolutionSuggestedAt: row.aiResolutionSuggestedAt,
      satisfactionRating: row.satisfactionRating,
      satisfactionComment: row.satisfactionComment,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      memberId: row.memberId,
      memberFullName: row.member.fullName,
      assignedAgentId: row.assignedAgentId,
      assignedAgentName: row.assignedAgent?.fullName ?? null,
      escalationNote: row.escalationNote,
      aiTurns: row.aiTurns,
      aiFailureCount: row.aiFailureCount,
      firstStaffReplyAt: row.firstStaffReplyAt,
      resolutionNote: row.resolutionNote,
    };
  }
}

function truncatePreview(value: string): string {
  const text = value.trim();
  return text.length <= 200 ? text : `${text.slice(0, 200)}�?�`;
}

function messageView(message: SupportMessage) {
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
