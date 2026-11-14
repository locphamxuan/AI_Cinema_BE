import { EmailStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import type { EmailOutboxService } from './email-outbox.service';
import { EmailRedeliverySweep, STUCK_AFTER_MS } from './email-redelivery.sweep';

describe('EmailRedeliverySweep', () => {
  const prisma = { emailMessage: { findMany: jest.fn() } };
  const queue = { every: jest.fn() };
  const outbox = { dispatch: jest.fn() };
  const config = { schedules: { emailRedeliverySweepMs: 900_000 } } as unknown as AppConfig;
  const sweep = new EmailRedeliverySweep(
    prisma as unknown as PrismaService,
    queue as unknown as JobQueue,
    outbox as unknown as EmailOutboxService,
    config,
  );
  const now = new Date('2026-11-14T05:00:00Z');

  beforeEach(() => jest.clearAllMocks());

  it('runs on the configured schedule', () => {
    sweep.onModuleInit();
    expect(queue.every).toHaveBeenCalledWith('email-redelivery.sweep', 900_000, expect.any(Function));
  });

  it('queues again only QUEUED mail older than the send retries, never a password-reset code', async () => {
    prisma.emailMessage.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);

    await expect(sweep.redeliverStuck(now)).resolves.toBe(2);

    expect(prisma.emailMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: EmailStatus.QUEUED,
          createdAt: { lte: new Date(now.getTime() - STUCK_AFTER_MS) },
          template: { not: 'PASSWORD_RESET_OTP' },
        },
      }),
    );
    expect(outbox.dispatch.mock.calls).toEqual([['e1'], ['e2']]);
  });

  it('does nothing when no mail is stuck', async () => {
    prisma.emailMessage.findMany.mockResolvedValue([]);
    await expect(sweep.redeliverStuck(now)).resolves.toBe(0);
    expect(outbox.dispatch).not.toHaveBeenCalled();
  });

  it('keeps going when one message cannot be queued (Redis still down)', async () => {
    prisma.emailMessage.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    outbox.dispatch.mockRejectedValueOnce(new Error('redis down')).mockResolvedValueOnce(undefined);

    await expect(sweep.redeliverStuck(now)).resolves.toBe(1);
    expect(outbox.dispatch).toHaveBeenCalledTimes(2);
  });
});
