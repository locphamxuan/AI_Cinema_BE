import { ConflictException } from '@nestjs/common';
import { SupportCloseReason, SupportSenderType, SupportStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ResolutionService } from './resolution.service';
import type { SupportConversationService } from './support-conversation.service';
import type { SupportMessageService } from './support-message.service';

const conversationIn = (status: SupportStatus, extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  memberId: 'm1',
  status,
  resolvedAt: null,
  ...extra,
});

describe('ResolutionService', () => {
  const tx = { tag: 'tx' };
  const prisma = { $transaction: jest.fn((run: (t: typeof tx) => unknown) => run(tx)) };
  const conversations = { findById: jest.fn(), move: jest.fn() };
  const messages = { create: jest.fn().mockResolvedValue({ id: 'msg-1' }) };
  const audit = { record: jest.fn() };
  const notifications = { notify: jest.fn() };
  const service = new ResolutionService(
    prisma as unknown as PrismaService,
    conversations as unknown as SupportConversationService,
    messages as unknown as SupportMessageService,
    audit as unknown as AuditLogService,
    notifications as unknown as NotificationService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((run: (t: typeof tx) => unknown) => run(tx));
    messages.create.mockResolvedValue({ id: 'msg-1' });
  });

  it('closes an AI-handled case as AI_RESOLVED, tells the member and audits it', async () => {
    conversations.findById.mockResolvedValue(conversationIn(SupportStatus.AI_HANDLING));
    conversations.move.mockResolvedValue({ conversation: conversationIn(SupportStatus.CLOSED), changed: true });

    await service.aiResolved('c1', 'm1');

    expect(conversations.move).toHaveBeenCalledWith(
      'c1',
      [SupportStatus.AI_HANDLING],
      SupportStatus.CLOSED,
      expect.objectContaining({ closeReason: SupportCloseReason.AI_RESOLVED, closedAt: expect.any(Date) }),
      tx,
    );
    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ senderType: SupportSenderType.SYSTEM, isInternal: false }),
      tx,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUPPORT_CASE_CLOSED, actorId: 'm1' }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      ['m1'],
      expect.objectContaining({ link: '/support/conversations/c1' }),
    );
  });

  it('keeps the first resolved time and writes the staff note when Staff closes', async () => {
    const resolvedAt = new Date('2026-11-10T03:00:00Z');
    conversations.findById.mockResolvedValue(conversationIn(SupportStatus.RESOLVED, { resolvedAt }));
    conversations.move.mockResolvedValue({ conversation: conversationIn(SupportStatus.CLOSED), changed: true });

    await service.staffClose('c1', 'staff-1', 'Đã hoàn Coin');

    expect(conversations.move).toHaveBeenCalledWith(
      'c1',
      [SupportStatus.RESOLVED, SupportStatus.STAFF_HANDLING],
      SupportStatus.CLOSED,
      expect.objectContaining({
        resolvedAt,
        resolutionNote: 'Đã hoàn Coin',
        closeReason: SupportCloseReason.STAFF_RESOLVED,
      }),
      tx,
    );
  });

  it('lets a member close a case still waiting for Staff', async () => {
    conversations.findById.mockResolvedValue(conversationIn(SupportStatus.WAITING_FOR_STAFF));
    conversations.move.mockResolvedValue({ conversation: conversationIn(SupportStatus.CLOSED), changed: true });

    await service.memberClose('c1', 'm1', 'Tự xử lý được');

    expect(messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Bạn đã đóng yêu cầu hỗ trợ: Tự xử lý được' }),
      tx,
    );
  });

  it('treats closing an already closed case as a no-op, with no second message or notice', async () => {
    const closed = conversationIn(SupportStatus.CLOSED);
    conversations.findById.mockResolvedValue(closed);

    await expect(service.memberClose('c1', 'm1')).resolves.toBe(closed);

    expect(conversations.move).not.toHaveBeenCalled();
    expect(messages.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('passes on a refused transition without notifying anyone', async () => {
    conversations.findById.mockResolvedValue(conversationIn(SupportStatus.STAFF_HANDLING));
    conversations.move.mockRejectedValue(new ConflictException('Support case cannot move'));

    await expect(service.aiResolved('c1', 'm1')).rejects.toThrow(ConflictException);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('resolves a case Staff is handling and tells the member', async () => {
    conversations.findById.mockResolvedValue(conversationIn(SupportStatus.STAFF_HANDLING));
    conversations.move.mockResolvedValue({ conversation: conversationIn(SupportStatus.RESOLVED), changed: true });

    await service.staffResolve('c1', 'staff-1', 'Đã sửa lỗi phát');

    expect(conversations.move).toHaveBeenCalledWith(
      'c1',
      SupportStatus.STAFF_HANDLING,
      SupportStatus.RESOLVED,
      { resolvedAt: expect.any(Date), resolutionNote: 'Đã sửa lỗi phát' },
      tx,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUPPORT_CASE_RESOLVED, actorId: 'staff-1' }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalledWith(['m1'], expect.objectContaining({ body: 'Đã sửa lỗi phát' }));
  });

  it('answers a repeated or concurrent resolve with the resolved case and no second notice', async () => {
    const resolved = conversationIn(SupportStatus.RESOLVED);
    conversations.move.mockResolvedValue({ conversation: resolved, changed: false });

    await expect(service.staffResolve('c1', 'staff-1')).resolves.toBe(resolved);
    expect(messages.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('writes nothing when a concurrent close won the race after this one read the case', async () => {
    // Both requests read STAFF_HANDLING; the other one closed the row first, so this move replays.
    const closed = conversationIn(SupportStatus.CLOSED);
    conversations.findById.mockResolvedValue(conversationIn(SupportStatus.STAFF_HANDLING));
    conversations.move.mockResolvedValue({ conversation: closed, changed: false });

    await expect(service.memberClose('c1', 'm1')).resolves.toBe(closed);
    expect(messages.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
