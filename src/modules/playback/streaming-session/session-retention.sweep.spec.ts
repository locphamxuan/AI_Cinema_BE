import { StreamingEndReason, StreamingSessionStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { dailyStats, SessionRetentionSweep } from './session-retention.sweep';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('SessionRetentionSweep.purgeDue', () => {
  const tx = { episodeWatchStat: { upsert: jest.fn() }, streamingSession: { deleteMany: jest.fn() } };
  const prisma = {
    streamingSession: { findMany: jest.fn(), deleteMany: tx.streamingSession.deleteMany },
    $transaction: jest.fn((work: (db: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const row = (id: string, overrides = {}) => ({
    id,
    episodeId: 'ep-1',
    startedAt: new Date('2026-07-01T03:00:00.000Z'),
    totalWatchedSeconds: 600,
    endReason: StreamingEndReason.STOPPED,
    ...overrides,
  });
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
    prisma.streamingSession.findMany.mockResolvedValueOnce([row('sess-1')]);
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
    const page = Array.from({ length: 500 }, (_, index) => row(`sess-${index}`));
    prisma.streamingSession.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([row('last')]);
    await expect(sweepWith(30).purgeDue()).resolves.toEqual({ sessions: 2 });
    expect(prisma.streamingSession.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('adds each page to the daily watch stats in the transaction that deletes it', async () => {
    prisma.streamingSession.findMany.mockResolvedValueOnce([
      row('a'),
      row('b', { totalWatchedSeconds: 300, endReason: StreamingEndReason.COMPLETED }),
    ]);
    await sweepWith(30).purgeDue();
    expect(tx.episodeWatchStat.upsert).toHaveBeenCalledWith({
      where: { episodeId_statDate: { episodeId: 'ep-1', statDate: new Date('2026-07-01') } },
      create: {
        episodeId: 'ep-1',
        statDate: new Date('2026-07-01'),
        sessions: 2,
        completedSessions: 1,
        totalWatchedSeconds: 900n,
      },
      update: {
        sessions: { increment: 2 },
        completedSessions: { increment: 1 },
        totalWatchedSeconds: { increment: 900n },
      },
    });
    const upsertOrder = tx.episodeWatchStat.upsert.mock.invocationCallOrder[0];
    expect(upsertOrder).toBeLessThan(tx.streamingSession.deleteMany.mock.invocationCallOrder[0]);
  });

  it('buckets by the Vietnam day the session started, per episode', () => {
    const stats = dailyStats([
      // 23:30 in Vietnam on 1 July and 00:30 on 2 July: two different days.
      row('a', { startedAt: new Date('2026-07-01T16:30:00.000Z') }),
      row('b', { startedAt: new Date('2026-07-01T17:30:00.000Z') }),
      row('c', { episodeId: 'ep-2' }),
    ]);
    expect(stats.map((stat) => [stat.episodeId, stat.statDate.toISOString().slice(0, 10)])).toEqual([
      ['ep-1', '2026-07-01'],
      ['ep-1', '2026-07-02'],
      ['ep-2', '2026-07-01'],
    ]);
  });

  it('keeps every row when retention is switched off', async () => {
    await expect(sweepWith(0).purgeDue()).resolves.toEqual({ sessions: 0 });
    expect(prisma.streamingSession.findMany).not.toHaveBeenCalled();
    expect(prisma.streamingSession.deleteMany).not.toHaveBeenCalled();
  });
});
