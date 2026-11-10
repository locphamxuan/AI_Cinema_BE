import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupportStatus, SupportSenderType } from '@prisma/client';
import { UserRole } from '@prisma/client';
import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { SupportConversationService } from '../chat/support-conversation.service';
import type { SupportMessageService } from '../chat/support-message.service';
import type { ResolutionService } from '../chat/resolution.service';
import type { SupportRecipientsService } from '../staff/support-recipients.service';
import type { MemberContextService } from '../staff/member-context.service';
import { StaffSupportService } from './staff-support.service';

const CASE_ID = 'conversation-1';
const MEMBER_ID = 'member-1';
const STAFF = { id: 'staff-1', role: UserRole.STAFF };
const OTHER_STAFF = { id: 'staff-2', role: UserRole.STAFF };
const ADMIN = { id: 'admin-1', role: UserRole.ADMIN };

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    memberId: MEMBER_ID,
    status: SupportStatus.WAITING_FOR_STAFF,
    priority: 'NORMAL',
    escalationReason: 'MEMBER_REQUEST',
    aiSummary: null,
    lastMessageAt: new Date('2026-11-09'),
    lastMemberMessageAt: new Date('2026-11-09'),
    lastStaffMessageAt: null,
    escalatedAt: new Date('2026-11-09'),
    claimedAt: null,
    resolvedAt: null,
    closedAt: null,
    closeReason: null,
    aiResolutionSuggestedAt: null,
    satisfactionRating: null,
    satisfactionComment: null,
    createdAt: new Date('2026-11-09'),
    updatedAt: new Date('2026-11-09'),
    assignedAgentId: null,
    firstStaffReplyAt: null,
    resolutionNote: null,
    member: { id: MEMBER_ID, fullName: 'Người dùng' },
    assignedAgent: null,
    ...overrides,
  };
}

function buildService() {
  const tx = {
    supportConversation: { update: jest.fn() },
  };
  const prisma = {
    supportConversation: {
      findUnique: jest.fn().mockResolvedValue(conversationRow()),
      findFirst: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'staff-9' }) },
    $transaction: jest.fn((callback: (tx: PrismaTx) => unknown) => callback(tx as unknown as PrismaTx)),
  };

  const conversations = {
    findById: jest.fn().mockResolvedValue(conversationRow()),
    transition: jest.fn().mockResolvedValue(conversationRow({ status: SupportStatus.STAFF_HANDLING })),
    touchMessages: jest.fn().mockResolvedValue(undefined),
    markRead: jest.fn().mockResolvedValue(undefined),
  };
  const messages = {
    create: jest.fn().mockResolvedValue({
      id: 'staff-message',
      conversationId: CASE_ID,
      senderType: SupportSenderType.SUPPORT_AGENT,
      senderId: STAFF.id,
      content: 'Xin chào',
      isInternal: false,
      clientMessageId: null,
      replyToMessageId: null,
      aiMetadata: null,
      createdAt: new Date('2026-11-09'),
    }),
    listForConversation: jest.fn().mockResolvedValue([]),
  };
  const resolution = {
    staffResolve: jest.fn().mockResolvedValue(undefined),
    staffClose: jest.fn().mockResolvedValue(undefined),
  };
  const recipients = {
    notifyAssigned: jest.fn().mockResolvedValue(undefined),
    notifyMemberReply: jest.fn().mockResolvedValue(undefined),
  };
  const memberContext = { getContext: jest.fn().mockResolvedValue({ memberId: MEMBER_ID, sections: {} }) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };

  const service = new StaffSupportService(
    prisma as unknown as PrismaService,
    conversations as unknown as SupportConversationService,
    messages as unknown as SupportMessageService,
    resolution as unknown as ResolutionService,
    recipients as unknown as SupportRecipientsService,
    memberContext as unknown as MemberContextService,
    audit as unknown as AuditLogService,
    notifications as unknown as NotificationService,
  );

  return { service, prisma, tx, conversations, messages, resolution, recipients, memberContext, audit, notifications };
}

describe('StaffSupportService.claim', () => {
  it('returns the case without work when it is already claimed by the same staff', async () => {
    const { service, prisma, conversations } = buildService();
    conversations.findById.mockResolvedValue(
      conversationRow({ status: SupportStatus.STAFF_HANDLING, assignedAgentId: STAFF.id }),
    );
    prisma.supportConversation.findUnique.mockResolvedValue(
      conversationRow({ status: SupportStatus.STAFF_HANDLING, assignedAgentId: STAFF.id }),
    );

    const view = await service.claim(CASE_ID, STAFF.id);

    expect(conversations.transition).not.toHaveBeenCalled();
    expect(view.assignedAgentId).toBe(STAFF.id);
  });

  it('transitions a waiting case into staff handling and audits it', async () => {
    const { service, conversations, audit } = buildService();

    const view = await service.claim(CASE_ID, STAFF.id);

    expect(conversations.transition).toHaveBeenCalledWith(
      CASE_ID,
      SupportStatus.WAITING_FOR_STAFF,
      SupportStatus.STAFF_HANDLING,
      { assignedAgentId: STAFF.id, claimedAt: expect.any(Date) },
      expect.anything(),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUPPORT_CASE_CLAIMED }),
      expect.anything(),
    );
    expect(view.memberFullName).toBe('Người dùng');
  });

  it('conflicts when the case is already handled by another staff member', async () => {
    const { service, conversations } = buildService();
    conversations.findById.mockResolvedValue(
      conversationRow({ status: SupportStatus.STAFF_HANDLING, assignedAgentId: OTHER_STAFF.id }),
    );

    await expect(service.claim(CASE_ID, STAFF.id)).rejects.toBeInstanceOf(ConflictException);
    expect(conversations.transition).not.toHaveBeenCalled();
  });

  it('conflicts when the race loser cannot win the guarded transition', async () => {
    const { service, conversations, audit } = buildService();
    conversations.transition.mockRejectedValue(new ConflictException('Support case cannot move'));

    await expect(service.claim(CASE_ID, STAFF.id)).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('StaffSupportService.release / assign', () => {
  it('releases the owner back to the queue and audits it', async () => {
    const { service, conversations, audit } = buildService();
    conversations.findById.mockResolvedValue(
      conversationRow({ status: SupportStatus.STAFF_HANDLING, assignedAgentId: STAFF.id }),
    );

    await service.release(CASE_ID, STAFF);

    expect(conversations.transition).toHaveBeenCalledWith(
      CASE_ID,
      SupportStatus.STAFF_HANDLING,
      SupportStatus.WAITING_FOR_STAFF,
      { assignedAgentId: null, claimedAt: null },
      expect.anything(),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUPPORT_CASE_RELEASED }),
      expect.anything(),
    );
  });

  it('lets an admin release a case owned by another staff, but forbids a peer', async () => {
    const { service, conversations } = buildService();
    conversations.findById.mockResolvedValue(
      conversationRow({ status: SupportStatus.STAFF_HANDLING, assignedAgentId: STAFF.id }),
    );

    await expect(service.release(CASE_ID, OTHER_STAFF)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.release(CASE_ID, ADMIN)).resolves.toBeDefined();
  });

  it('treats release on a waiting case as a no-op', async () => {
    const { service, conversations } = buildService();
    conversations.findById.mockResolvedValue(conversationRow({ status: SupportStatus.WAITING_FOR_STAFF }));

    const view = await service.release(CASE_ID, STAFF);

    expect(conversations.transition).not.toHaveBeenCalled();
    expect(view.status).toBe(SupportStatus.WAITING_FOR_STAFF);
  });

  it('validates the assignee and notifies them on assignment', async () => {
    const { service, prisma, recipients } = buildService();
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.assign(CASE_ID, 'member-1', ADMIN.id)).rejects.toBeInstanceOf(BadRequestException);

    prisma.user.findFirst.mockResolvedValue({ id: 'staff-9' });
    const view = await service.assign(CASE_ID, 'staff-9', ADMIN.id);

    expect(prisma.supportConversation.updateMany).toHaveBeenCalledWith({
      where: { id: CASE_ID, status: { in: [SupportStatus.WAITING_FOR_STAFF, SupportStatus.STAFF_HANDLING] } },
      data: expect.objectContaining({ status: SupportStatus.STAFF_HANDLING, assignedAgentId: 'staff-9' }),
    });
    expect(recipients.notifyAssigned).toHaveBeenCalledWith(expect.objectContaining({ id: CASE_ID }), 'staff-9');
    expect(view.memberId).toBe(MEMBER_ID);
  });

  it('aborts the assignment when the case changes under it', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.assign(CASE_ID, 'staff-9', ADMIN.id)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('StaffSupportService.reply', () => {
  it('auto-claims a waiting case on the first reply and notifies the member', async () => {
    const { service, conversations, messages, tx, notifications } = buildService();

    const result = await service.reply(CASE_ID, STAFF, { content: 'Xin chào, mình hỗ trợ bạn.' });

    expect(conversations.transition).toHaveBeenCalledWith(
      CASE_ID,
      SupportStatus.WAITING_FOR_STAFF,
      SupportStatus.STAFF_HANDLING,
      expect.objectContaining({ assignedAgentId: STAFF.id }),
      expect.anything(),
    );
    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ senderType: SupportSenderType.SUPPORT_AGENT, senderId: STAFF.id, isInternal: false }),
      expect.anything(),
    );
    expect(conversations.touchMessages).toHaveBeenCalledWith(
      CASE_ID,
      SupportSenderType.SUPPORT_AGENT,
      expect.any(Date),
      expect.anything(),
    );
    expect(tx.supportConversation.update).toHaveBeenCalledWith({
      where: { id: CASE_ID },
      data: { firstStaffReplyAt: expect.any(Date) },
    });
    expect(notifications.notify).toHaveBeenCalledWith([MEMBER_ID], {
      type: NOTIFICATION_TYPE.SUPPORT_AGENT_REPLIED,
      title: 'Nhân viên phản hồi yêu cầu hỗ trợ',
      body: 'Xin chào, mình hỗ trợ bạn.',
      link: `/support/conversations/${CASE_ID}`,
      payload: { conversationId: CASE_ID },
    });
    expect(result.message.senderType).toBe(SupportSenderType.SUPPORT_AGENT);
  });

  it('keeps an internal note invisible to the member: no touch, no notification', async () => {
    const { service, conversations, messages, tx, notifications } = buildService();

    await service.reply(CASE_ID, STAFF, { content: 'Ghi chú nội bộ', isInternal: true });

    expect(messages.create).toHaveBeenCalledWith(expect.objectContaining({ isInternal: true }), expect.anything());
    expect(conversations.touchMessages).not.toHaveBeenCalled();
    expect(tx.supportConversation.update).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('refuses replies on resolved/closed cases and foreign assignments', async () => {
    const { service, conversations } = buildService();

    conversations.findById.mockResolvedValue(conversationRow({ status: SupportStatus.RESOLVED }));
    await expect(service.reply(CASE_ID, STAFF, { content: 'Xin chào' })).rejects.toBeInstanceOf(ConflictException);

    conversations.findById.mockResolvedValue(conversationRow({ status: SupportStatus.CLOSED }));
    await expect(service.reply(CASE_ID, STAFF, { content: 'Xin chào' })).rejects.toBeInstanceOf(ConflictException);

    conversations.findById.mockResolvedValue(
      conversationRow({ status: SupportStatus.STAFF_HANDLING, assignedAgentId: OTHER_STAFF.id }),
    );
    await expect(service.reply(CASE_ID, STAFF, { content: 'Xin chào' })).rejects.toBeInstanceOf(ForbiddenException);

    // An admin may still answer someone else's case.
    await expect(service.reply(CASE_ID, ADMIN, { content: 'Xin chào' })).resolves.toBeDefined();
  });

  it('rejects empty replies', async () => {
    const { service } = buildService();
    await expect(service.reply(CASE_ID, STAFF, { content: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('StaffSupportService.resolve / close / detail', () => {
  it('resolves then views the updated case', async () => {
    const { service, resolution } = buildService();

    const view = await service.resolve(CASE_ID, STAFF.id, 'Đã xử lý xong');

    expect(resolution.staffResolve).toHaveBeenCalledWith(CASE_ID, STAFF.id, 'Đã xử lý xong');
    expect(view.memberId).toBe(MEMBER_ID);
  });

  it('closes then views the updated case', async () => {
    const { service, resolution } = buildService();

    const view = await service.close(CASE_ID, STAFF.id, 'Member xác nhận');

    expect(resolution.staffClose).toHaveBeenCalledWith(CASE_ID, STAFF.id, 'Member xác nhận');
    expect(view.memberId).toBe(MEMBER_ID);
  });

  it('serves the detail with internal notes and marks the case read by staff', async () => {
    const { service, prisma, conversations, messages } = buildService();
    prisma.supportConversation.findUnique.mockResolvedValue(conversationRow());
    messages.listForConversation.mockResolvedValue([
      {
        id: 'm-2',
        senderType: SupportSenderType.SUPPORT_AGENT,
        content: 'Note',
        isInternal: true,
        clientMessageId: null,
        replyToMessageId: null,
        aiMetadata: null,
        createdAt: new Date(),
      },
      {
        id: 'm-1',
        senderType: SupportSenderType.SUPPORT_AGENT,
        content: 'Reply',
        isInternal: false,
        clientMessageId: null,
        replyToMessageId: null,
        aiMetadata: null,
        createdAt: new Date(),
      },
    ]);

    const detail = await service.detail(CASE_ID);

    expect(messages.listForConversation).toHaveBeenCalledWith(CASE_ID, { limit: 100, includeInternal: true });
    expect(conversations.markRead).toHaveBeenCalledWith(CASE_ID, 'staff');
    expect(detail.messages.map((message) => message.id)).toEqual(['m-1', 'm-2']);
    expect(detail.messages.find((message) => message.id === 'm-2')?.isInternal).toBe(true);
  });

  it('returns 404 for a missing case', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.findUnique.mockResolvedValue(null);

    await expect(service.detail('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('StaffSupportService.stats', () => {
  it('reports rate 0 when nothing was ever closed in the window', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.groupBy = jest
      .fn()
      .mockResolvedValueOnce([
        { status: 'CLOSED', _count: { _all: 3 } },
        { status: 'WAITING_FOR_STAFF', _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([{ escalationReason: 'MEMBER_REQUEST', _count: { _all: 2 } }]);
    prisma.supportConversation.findFirst = jest.fn().mockResolvedValue(null);
    prisma.supportConversation.count = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const stats = await service.stats();

    expect(stats.byStatus.CLOSED).toBe(3);
    expect(stats.waiting).toBe(2);
    expect(stats.oldestWaiting).toBeNull();
    expect(stats.aiResolvedRate).toBe(0);
    expect(stats.topEscalationReasons).toEqual([{ reason: 'MEMBER_REQUEST', count: 2 }]);
  });
});
