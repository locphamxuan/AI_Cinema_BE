import { NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { SUB_REASON } from './subscription-rules';
import { SubscriptionAdminService } from './subscription-admin.service';

describe('SubscriptionAdminService', () => {
  const tx = { subscription: { updateMany: jest.fn(), findUnique: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    subscription: { findFirst: jest.fn(), findUnique: jest.fn() },
    subscriptionCycle: { findMany: jest.fn() },
  };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new SubscriptionAdminService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('detail answers 404 for an unknown subscription', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);
    await expect(service.detail('missing')).rejects.toThrow(NotFoundException);
  });

  it('ends an open plan now with an audit trail', async () => {
    tx.subscription.updateMany.mockResolvedValue({ count: 1 });
    tx.subscription.findUnique.mockResolvedValue({ id: 'sub-1', userId: 'u1', status: SubscriptionStatus.CANCELLED });

    const result = await service.cancelByAdmin('sub-1', 'admin-1', 'fraud');

    expect(tx.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', status: { in: ['PENDING', 'ACTIVE', 'PAST_DUE'] } },
      data: expect.objectContaining({ status: SubscriptionStatus.CANCELLED, endReason: 'CANCELLED_BY_ADMIN' }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUBSCRIPTION_CANCELLED, actorId: 'admin-1' }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalledWith(['u1'], expect.anything(), tx);
    expect(result).toMatchObject({ status: SubscriptionStatus.CANCELLED });
  });

  it('keeps the history of a plan that already ended', async () => {
    tx.subscription.updateMany.mockResolvedValue({ count: 0 });
    tx.subscription.findUnique.mockResolvedValue({ id: 'sub-1', userId: 'u1', status: SubscriptionStatus.EXPIRED });

    await expect(service.cancelByAdmin('sub-1', 'admin-1')).rejects.toMatchObject({
      response: { details: { reason: SUB_REASON.ENDED } },
    });
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown plan', async () => {
    tx.subscription.updateMany.mockResolvedValue({ count: 0 });
    tx.subscription.findUnique.mockResolvedValue(null);

    await expect(service.cancelByAdmin('missing', 'admin-1')).rejects.toMatchObject({
      response: { details: { reason: SUB_REASON.NOT_FOUND } },
    });
  });
});
