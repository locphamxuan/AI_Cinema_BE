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
    supportConversation: { findMany: jest.fn(), fields: { aiResolutionSuggestedAt: 'ai_resolution_suggested_at' } },
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
    lastMemberMessageAt: hoursAgo(60),
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    conversations.transition.mockResolvedValue({});
  });
  afterEach(() => jest.useRealTimers());

  it('registers the recurring sweep on the configured interval', async () => {
    sweep.onModuleInit();
    expect(queue.every).toHaveBeenCalledWith('support.auto-close.sweep', 900_000, expect.any(Function));

    prisma.supportConversation.findMany.mockResolvedValue([]);
    const handler = (queue.every.mock.calls as unknown[][])[0][2] as () => Promise<unknown>;
    await expect(handler()).resolves.toBeUndefined();
  });

  it('queries only AI-handled cases whose suggestion is older than the cutoff', async () => {
    prisma.supportConversation.findMany.mockResolvedValue([]);

    await expect(sweep.run()).resolves.toEqual({ closed: 0 });
    expect(prisma.supportConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: SupportStatus.AI_HANDLING,
          aiResolutionSuggestedAt: { not: null, lt: hoursAgo(48) },
          // Cases the member answered after the suggestion are filtered in SQL, so they cannot fill the batch.
          OR: [{ lastMemberMessageAt: null }, { lastMemberMessageAt: { lte: 'ai_resolution_suggested_at' } }],
        },
        take: 200,
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('closes an inactive case for INACTIVITY, posts a system message, audits and notifies', async () => {
    prisma.supportConversation.findMany.mockResolvedValue([candidate('c1')]);

    await expect(sweep.run()).resolves.toEqual({ closed: 1 });

    expect(conversations.transition).toHaveBeenCalledWith(
      'c1',
      SupportStatus.AI_HANDLING,
      SupportStatus.CLOSED,
      { closedAt: NOW, resolvedAt: hoursAgo(50), closeReason: SupportCloseReason.INACTIVITY },
      tx,
    );
    expect(tx.supportMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'c1',
        senderType: SupportSenderType.SYSTEM,
        senderId: null,
        isInternal: false,
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.SUPPORT_CASE_CLOSED,
        entityId: 'c1',
        actorId: null,
        payload: { closeReason: SupportCloseReason.INACTIVITY, automatic: true },
      }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      ['member-c1'],
      expect.objectContaining({ type: NOTIFICATION_TYPE.SUPPORT_CASE_CLOSED, link: '/support/conversations/c1' }),
    );
  });

  it('keeps an existing resolvedAt instead of overwriting it', async () => {
    const resolvedAt = hoursAgo(55);
    prisma.supportConversation.findMany.mockResolvedValue([candidate('c1', { resolvedAt })]);

    await sweep.run();
    expect((conversations.transition.mock.calls as unknown[][])[0][3]).toMatchObject({ resolvedAt });
  });

  it('closes a case whose member never wrote at all', async () => {
    prisma.supportConversation.findMany.mockResolvedValue([candidate('c1', { lastMemberMessageAt: null })]);

    await expect(sweep.run()).resolves.toEqual({ closed: 1 });
  });

  it('skips a case the member answered after the suggestion (the clock restarts)', async () => {
    prisma.supportConversation.findMany.mockResolvedValue([candidate('c1', { lastMemberMessageAt: hoursAgo(49) })]);

    await expect(sweep.run()).resolves.toEqual({ closed: 0 });
    expect(conversations.transition).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('closes a case whose last member message is exactly at the suggestion time', async () => {
    const at = hoursAgo(50);
    prisma.supportConversation.findMany.mockResolvedValue([
      candidate('c1', { aiResolutionSuggestedAt: at, lastMemberMessageAt: new Date(at) }),
    ]);

    await expect(sweep.run()).resolves.toEqual({ closed: 1 });
  });

  it('skips a row without a suggestion time defensively', async () => {
    prisma.supportConversation.findMany.mockResolvedValue([candidate('c1', { aiResolutionSuggestedAt: null })]);

    await expect(sweep.run()).resolves.toEqual({ closed: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips a case a concurrent Staff claim already moved, and still closes the others', async () => {
    prisma.supportConversation.findMany.mockResolvedValue([candidate('c1'), candidate('c2')]);
    conversations.transition
      .mockRejectedValueOnce(new ConflictException('Support case cannot move from STAFF_HANDLING to CLOSED'))
      .mockResolvedValueOnce({});

    await expect(sweep.run()).resolves.toEqual({ closed: 1 });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(['member-c2'], expect.anything());
  });

  it('still counts a case that closed when only its notification failed', async () => {
    prisma.supportConversation.findMany.mockResolvedValue([candidate('c1')]);
    notifications.notify.mockRejectedValueOnce('push down');

    await expect(sweep.run()).resolves.toEqual({ closed: 1 });
  });
});
