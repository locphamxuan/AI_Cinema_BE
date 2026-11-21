import { ConflictException } from '@nestjs/common';
import { SupportCloseReason, SupportSenderType, SupportStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { SupportConversationService } from './chat/support-conversation.service';
import { SupportAutoCloseSweep } from './support-auto-close.sweep';

describe('SupportAutoCloseSweep', () => {
  const NOW = new Date('2026-11-10T12:00:00.000Z');
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
  const tx = { supportMessage: { create: jest.fn() } };
  const prisma = {
    supportConversation: {
      findMany: jest.fn(),
      fields: { aiResolutionSuggestedAt: 'ai_resolution_suggested_at', resolvedAt: 'resolved_at' },
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const conversations = { transition: jest.fn() };
  const queue = { every: jest.fn() };
  const audit = { record: jest.fn() };
  const notifications = { notify: jest.fn() };
  const config = { support: { autoCloseHours: 48, autoCloseSweepMs: 900_000 } };
  const sweep = new SupportAutoCloseSweep(
    config as unknown as AppConfig,
    prisma as unknown as PrismaService,
    conversations as unknown as SupportConversationService,
    queue as unknown as JobQueue,
    audit as unknown as AuditLogService,
    notifications as unknown as NotificationService,
  );

  const candidate = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    memberId: `member-${id}`,
    aiResolutionSuggestedAt: hoursAgo(50),
    resolvedAt: null,
    ...over,
  });
  /** The AI rule runs first, then the RESOLVED rule. */
  const found = (aiCases: unknown[], resolvedCases: unknown[] = []) =>
    prisma.supportConversation.findMany.mockResolvedValueOnce(aiCases).mockResolvedValueOnce(resolvedCases);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    conversations.transition.mockResolvedValue({});
  });
  afterEach(() => jest.useRealTimers());

  it('registers the recurring sweep on the configured interval', async () => {
    sweep.onModuleInit();
    expect(queue.every).toHaveBeenCalledWith('support.auto-close.sweep', 900_000, expect.any(Function));

    found([]);
    const handler = (queue.every.mock.calls as unknown[][])[0][2] as () => Promise<unknown>;
    await expect(handler()).resolves.toBeUndefined();
  });

  it('queries the cases whose answer is older than the cutoff and the member did not answer since', async () => {
    found([]);

    await expect(sweep.run()).resolves.toEqual({ closed: 0 });
    const [ai, resolved] = prisma.supportConversation.findMany.mock.calls.map(([query]) => query as { where: unknown });
    expect(ai).toMatchObject({
      where: {
        status: SupportStatus.AI_HANDLING,
        aiResolutionSuggestedAt: { not: null, lt: hoursAgo(48) },
        // Filtered in SQL, so cases the member answered cannot fill the batch.
        OR: [{ lastMemberMessageAt: null }, { lastMemberMessageAt: { lte: 'ai_resolution_suggested_at' } }],
      },
      take: 200,
    });
    expect(resolved).toMatchObject({
      where: {
        status: SupportStatus.RESOLVED,
        resolvedAt: { not: null, lt: hoursAgo(48) },
        OR: [{ lastMemberMessageAt: null }, { lastMemberMessageAt: { lte: 'resolved_at' } }],
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('closes an inactive AI case for INACTIVITY, posts a system message, audits and notifies', async () => {
    found([candidate('c1')]);

    await expect(sweep.run()).resolves.toEqual({ closed: 1 });

    expect(conversations.transition).toHaveBeenCalledWith(
      'c1',
      SupportStatus.AI_HANDLING,
      SupportStatus.CLOSED,
      { closedAt: NOW, resolvedAt: hoursAgo(50), closeReason: SupportCloseReason.INACTIVITY },
      tx,
    );
    expect(tx.supportMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ conversationId: 'c1', senderType: SupportSenderType.SYSTEM, isInternal: false }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.SUPPORT_CASE_CLOSED,
        entityId: 'c1',
        actorId: null,
        payload: { closeReason: SupportCloseReason.INACTIVITY, automatic: true, from: SupportStatus.AI_HANDLING },
      }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      ['member-c1'],
      expect.objectContaining({ type: NOTIFICATION_TYPE.SUPPORT_CASE_CLOSED, link: '/support/conversations/c1' }),
    );
  });

  it('closes a case Staff resolved once the member let it be, keeping the time it was resolved', async () => {
    const resolvedAt = hoursAgo(55);
    found([], [candidate('c2', { aiResolutionSuggestedAt: null, resolvedAt })]);

    await expect(sweep.run()).resolves.toEqual({ closed: 1 });

    expect(conversations.transition).toHaveBeenCalledWith(
      'c2',
      SupportStatus.RESOLVED,
      SupportStatus.CLOSED,
      expect.objectContaining({ resolvedAt, closeReason: SupportCloseReason.INACTIVITY }),
      tx,
    );
    expect((tx.supportMessage.create.mock.calls as { data: { content: string } }[][])[0][0].data.content).toContain(
      'nhân viên xử lý xong',
    );
  });

  it('falls back to now when a row carries neither time', async () => {
    found([candidate('c3', { aiResolutionSuggestedAt: null })]);
    await sweep.run();
    expect((conversations.transition.mock.calls as unknown[][])[0][3]).toMatchObject({ resolvedAt: NOW });
  });

  it('skips a case a concurrent Staff claim already moved, and still closes the others', async () => {
    found([candidate('c1'), candidate('c2')]);
    conversations.transition
      .mockRejectedValueOnce(new ConflictException('Support case cannot move from STAFF_HANDLING to CLOSED'))
      .mockRejectedValueOnce('not an error')
      .mockResolvedValueOnce({});
    found([candidate('c3')]);

    await expect(sweep.run()).resolves.toEqual({ closed: 0 });
    await expect(sweep.run()).resolves.toEqual({ closed: 1 });
    expect(notifications.notify).toHaveBeenCalledWith(['member-c3'], expect.anything());
  });

  it('still counts a case that closed when only its notification failed', async () => {
    found([candidate('c1')]);
    notifications.notify.mockRejectedValueOnce(new Error('push down'));

    await expect(sweep.run()).resolves.toEqual({ closed: 1 });
  });
});
