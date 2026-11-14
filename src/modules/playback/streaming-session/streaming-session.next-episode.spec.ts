import { EpisodeStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { StreamingSessionService } from './streaming-session.service';

describe('StreamingSessionService.nextEpisode', () => {
  const prisma = { episode: { findUnique: jest.fn(), findFirst: jest.fn() } };
  // Only the episode reads matter here; every other dependency is off the next-episode path.
  const service = new StreamingSessionService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns the next released episode of the movie (steps 22–24)', async () => {
    prisma.episode.findUnique.mockResolvedValue({ movieId: 'm-1', episodeNumber: 1 });
    prisma.episode.findFirst.mockResolvedValue({ id: 'ep-2', movieId: 'm-1', episodeNumber: 2, title: 'Tập 2' });
    await expect(service.nextEpisode('ep-1')).resolves.toMatchObject({ episodeId: 'ep-2', episodeNumber: 2 });
    expect(prisma.episode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          movieId: 'm-1',
          episodeNumber: { gt: 1 },
          status: EpisodeStatus.PUBLISHED,
          // P5-2: never hand Main Flow 2 an episode that would answer 409 UNDER_REVISION.
          revisionStartedAt: null,
        }),
        orderBy: { episodeNumber: 'asc' },
      }),
    );
  });

  it('does not offer an episode taken down for revision (P5-2)', async () => {
    prisma.episode.findUnique.mockResolvedValue({ movieId: 'm-1', episodeNumber: 1 });
    // Episode 2 is under revision, so the query skips it; nothing else is published yet.
    prisma.episode.findFirst.mockResolvedValue(null);

    await expect(service.nextEpisode('ep-1')).resolves.toMatchObject({ episodeId: null });
    expect(prisma.episode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revisionStartedAt: null, status: EpisodeStatus.PUBLISHED }),
      }),
    );
  });

  it('answers null at the end of the movie and 404 for a missing episode', async () => {
    prisma.episode.findUnique.mockResolvedValueOnce({ movieId: 'm-1', episodeNumber: 3 });
    prisma.episode.findFirst.mockResolvedValue(null);
    await expect(service.nextEpisode('ep-3')).resolves.toMatchObject({ episodeId: null });

    prisma.episode.findUnique.mockResolvedValueOnce(null);
    await expect(service.nextEpisode('missing')).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ reason: 'EPISODE_NOT_FOUND' }) }),
    });
  });
});
