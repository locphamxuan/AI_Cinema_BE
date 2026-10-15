import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WatchProgressService } from './watch-progress.service';

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
});
