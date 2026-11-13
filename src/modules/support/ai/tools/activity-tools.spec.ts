import { ActivityTools } from './activity-tools';

function setup() {
  const prisma = {
    watchProgress: { findMany: jest.fn().mockResolvedValue([]) },
    episodeAccess: { findMany: jest.fn().mockResolvedValue([]) },
    publication: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const catalog = {
    ranking: jest.fn().mockResolvedValue([{ id: 'm1', title: 'Phim A', viewCount: 42, posterUrl: 'x' }]),
  };
  const recommendations = {
    forYou: jest.fn().mockResolvedValue([{ movieId: 'm2', title: 'Phim B', reason: 'Hợp gu', score: 0.9 }]),
  };
  const dailyRewards = { status: jest.fn().mockResolvedValue({ checkedInToday: false }) };
  const tools = new ActivityTools(prisma as never, catalog as never, recommendations as never, dailyRewards as never);
  return { tools, prisma, catalog, recommendations, dailyRewards };
}

const movieRow = { episodeNumber: 3, movie: { title: 'Phim A' } };

describe('ActivityTools (AI Support lookups, audit 2026-11-12)', () => {
  it('reports the most viewed movies with only the fields the answer needs', async () => {
    const { tools, catalog } = setup();
    await expect(tools.trendingMovies()).resolves.toEqual({
      ok: true,
      data: [{ id: 'm1', title: 'Phim A', viewCount: 42 }],
    });
    expect(catalog.ranking).toHaveBeenCalledWith(10);
  });

  it('gives the member their own recommendations with the reason', async () => {
    const { tools, recommendations } = setup();
    await expect(tools.myRecommendations('u1')).resolves.toEqual({
      ok: true,
      data: [{ movieId: 'm2', title: 'Phim B', reason: 'Hợp gu' }],
    });
    expect(recommendations.forYou).toHaveBeenCalledWith('u1');
  });

  it('reads watch history, unlocks and rewards of the session member only', async () => {
    const { tools, prisma, dailyRewards } = setup();
    const at = new Date('2026-11-12T00:00:00Z');
    prisma.watchProgress.findMany.mockResolvedValue([
      { positionSeconds: 30, durationSeconds: 90, completed: false, lastWatchedAt: at, episode: movieRow },
    ]);
    prisma.episodeAccess.findMany.mockResolvedValue([
      { source: 'COIN', paidCoins: 10, grantedAt: at, revokedAt: null, revokeReason: null, episode: movieRow },
    ]);
    await expect(tools.watchHistory('u1')).resolves.toMatchObject({
      data: [{ movie: 'Phim A', episodeNumber: 3, completed: false }],
    });
    await expect(tools.unlockedEpisodes('u1')).resolves.toMatchObject({ data: [{ movie: 'Phim A', paidCoins: 10 }] });
    await expect(tools.rewardStatus('u1')).resolves.toEqual({ ok: true, data: { checkedInToday: false } });
    expect(prisma.watchProgress.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
    expect(prisma.episodeAccess.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
    expect(dailyRewards.status).toHaveBeenCalledWith('u1');
  });

  it('lists the releases scheduled in the future', async () => {
    const { tools, prisma } = setup();
    const at = new Date('2026-12-01T00:00:00Z');
    prisma.publication.findMany.mockResolvedValue([{ scheduledAt: at, episode: movieRow }]);
    await expect(tools.upcomingReleases()).resolves.toEqual({
      ok: true,
      data: [{ movie: 'Phim A', episodeNumber: 3, releaseAt: at }],
    });
  });
});
