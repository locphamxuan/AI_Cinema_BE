import { EpisodeStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { VISIBLE_EPISODE } from 'src/modules/catalog/episode-visibility';
import { StreamingSessionService } from './streaming-session.service';

describe('StreamingSessionService.nextEpisode', () => {
  const prisma = { episode: { findFirst: jest.fn() } };
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

  it('returns the next released episode of the movie (steps 22-24)', async () => {
    prisma.episode.findFirst
      .mockResolvedValueOnce({ movieId: 'm-1', episodeNumber: 1 })
      .mockResolvedValueOnce({ id: 'ep-2', movieId: 'm-1', episodeNumber: 2, title: 'Tập 2' });
    await expect(service.nextEpisode('ep-1')).resolves.toMatchObject({ episodeId: 'ep-2', episodeNumber: 2 });
    expect(prisma.episode.findFirst).toHaveBeenLastCalledWith(
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

  it('only starts from an episode viewers can see, so a hidden one leaks no movie id', async () => {
    prisma.episode.findFirst.mockResolvedValueOnce(null);
    await expect(service.nextEpisode('draft')).rejects.toMatchObject({
      response: expect.objectContaining({ details: { reason: 'EPISODE_NOT_FOUND' } }),
    });
    expect(prisma.episode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'draft', ...VISIBLE_EPISODE } }),
    );
  });

  it('does not offer an episode taken down for revision (P5-2)', async () => {
    prisma.episode.findFirst.mockResolvedValueOnce({ movieId: 'm-1', episodeNumber: 1 }).mockResolvedValueOnce(null);

    await expect(service.nextEpisode('ep-1')).resolves.toMatchObject({ episodeId: null });
    expect(prisma.episode.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revisionStartedAt: null, status: EpisodeStatus.PUBLISHED }),
      }),
    );
  });

  it('answers null at the end of the movie', async () => {
    prisma.episode.findFirst.mockResolvedValueOnce({ movieId: 'm-1', episodeNumber: 3 }).mockResolvedValueOnce(null);
    await expect(service.nextEpisode('ep-3')).resolves.toMatchObject({ episodeId: null });
  });
});
