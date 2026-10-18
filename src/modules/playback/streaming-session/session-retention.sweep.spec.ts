import { StreamingSessionStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { SessionRetentionSweep } from './session-retention.sweep';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('SessionRetentionSweep.purgeDue', () => {
  const prisma = { streamingSession: { findMany: jest.fn(), deleteMany: jest.fn() } };
  const queue = { every: jest.fn() };
  const sweepWith = (sessionRetentionDays: number) =>
    new SessionRetentionSweep(
      prisma as unknown as PrismaService,
      queue as unknown as JobQueue,
      {
        schedules: { streamingSessionRetentionSweepMs: DAY_MS },
        playback: { sessionRetentionDays },
      } as unknown as AppConfig,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.streamingSession.findMany.mockResolvedValue([]);
    prisma.streamingSession.deleteMany.mockResolvedValue({ count: 1 });
  });

  it('deletes finished sessions older than the retention window, ACTIVE ones never', async () => {
    prisma.streamingSession.findMany.mockResolvedValueOnce([{ id: 'sess-1' }]);
    const now = new Date('2026-10-15T10:00:00.000Z');
    await expect(sweepWith(30).purgeDue(now)).resolves.toEqual({ sessions: 1 });
    expect(prisma.streamingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: StreamingSessionStatus.ACTIVE },
          endedAt: { lte: new Date(now.getTime() - 30 * DAY_MS) },
        },
      }),
    );
    expect(prisma.streamingSession.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['sess-1'] } } });
  });

  it('drains the backlog page by page', async () => {
    const page = Array.from({ length: 500 }, (_, index) => ({ id: `sess-${index}` }));
    prisma.streamingSession.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([{ id: 'last' }]);
    await expect(sweepWith(30).purgeDue()).resolves.toEqual({ sessions: 2 });
    expect(prisma.streamingSession.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('keeps every row when retention is switched off', async () => {
    await expect(sweepWith(0).purgeDue()).resolves.toEqual({ sessions: 0 });
    expect(prisma.streamingSession.findMany).not.toHaveBeenCalled();
    expect(prisma.streamingSession.deleteMany).not.toHaveBeenCalled();
  });
});
