import { EpisodeStatus, Prisma } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { REMOVED_NOTICE, REVISION_NOTICE } from 'src/modules/catalog/episode-visibility';
import { historyItem, WatchProgressService } from './watch-progress.service';

describe('WatchProgressService', () => {
  const prisma = {
    watchProgress: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const service = new WatchProgressService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('answers blank when the episode was never opened (step 8)', async () => {
    prisma.watchProgress.findUnique.mockResolvedValue(null);
    await expect(service.progress('u-1', 'ep-1')).resolves.toMatchObject({
      episodeId: 'ep-1',
      found: false,
      positionSeconds: 0,
      completed: false,
    });
  });

  it('returns the saved position (step 9)', async () => {
    prisma.watchProgress.findUnique.mockResolvedValue({
      positionSeconds: 320,
      durationSeconds: 1200,
      completed: false,
      completedAt: null,
      lastWatchedAt: new Date(),
    });
    await expect(service.progress('u-1', 'ep-1')).resolves.toMatchObject({
      found: true,
      positionSeconds: 320,
      completed: false,
    });
  });

  it('creates the row on first save and never un-completes (step 20)', async () => {
    prisma.watchProgress.findUnique.mockResolvedValueOnce(null);
    await service.save('u-1', 'ep-1', {
      positionSeconds: 100,
      durationSeconds: 1200,
      completed: false,
      at: new Date(),
    });
    expect(prisma.watchProgress.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u-1', completed: false }) }),
    );

    prisma.watchProgress.findUnique.mockResolvedValue({
      id: 'wp-1',
      completed: true,
      completedAt: new Date('2026-10-14T00:00:00.000Z'),
    });
    await service.save('u-1', 'ep-1', { positionSeconds: 10, durationSeconds: 1200, completed: false, at: new Date() });
    expect(prisma.watchProgress.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          completed: true,
          completedAt: new Date('2026-10-14T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('applies the update when two tabs race the first insert (P3-1)', async () => {
    const at = new Date('2026-10-21T10:00:00.000Z');
    prisma.watchProgress.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'wp-1', completed: true, completedAt: new Date('2026-10-20T00:00:00.000Z') });
    prisma.watchProgress.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await service.save('u-1', 'ep-1', {
      positionSeconds: 120,
      durationSeconds: 1200,
      completed: false,
      at,
    });

    expect(prisma.watchProgress.update).toHaveBeenCalledWith({
      where: { id: 'wp-1' },
      data: expect.objectContaining({
        positionSeconds: 120,
        completed: true,
        completedAt: new Date('2026-10-20T00:00:00.000Z'),
        lastWatchedAt: at,
      }),
    });
  });

  it('still fails on a create error that is not a unique violation (P3-1)', async () => {
    prisma.watchProgress.findUnique.mockResolvedValue(null);
    prisma.watchProgress.create.mockRejectedValueOnce(new Error('database is down'));

    await expect(
      service.save('u-1', 'ep-1', { positionSeconds: 10, durationSeconds: 1200, completed: false, at: new Date() }),
    ).rejects.toThrow('database is down');
    expect(prisma.watchProgress.update).not.toHaveBeenCalled();
  });

  describe('history availability (P3-4)', () => {
    const row = (overrides: { status?: EpisodeStatus; revisionStartedAt?: Date | null } = {}) => ({
      positionSeconds: 320,
      durationSeconds: 1200,
      completed: false,
      lastWatchedAt: new Date('2026-10-15T10:00:00.000Z'),
      episode: {
        id: 'ep-1',
        title: 'Tập 1',
        episodeNumber: 1,
        thumbnailUrl: null,
        movieId: 'm-1',
        status: overrides.status ?? EpisodeStatus.PUBLISHED,
        revisionStartedAt: overrides.revisionStartedAt ?? null,
        movie: { title: 'Phim' },
      },
    });

    it('leaves a published episode openable', () => {
      expect(historyItem(row())).toMatchObject({ available: true, notice: null });
    });

    it('flags an episode under revision with the maintenance notice', () => {
      expect(historyItem(row({ revisionStartedAt: new Date() }))).toMatchObject({
        available: false,
        notice: REVISION_NOTICE,
      });
    });

    it('flags an episode taken down for good as removed', () => {
      expect(historyItem(row({ status: EpisodeStatus.UNPUBLISHED }))).toMatchObject({
        available: false,
        notice: REMOVED_NOTICE,
      });
    });
  });
});
