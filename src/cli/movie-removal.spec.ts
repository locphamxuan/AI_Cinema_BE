import type { PrismaClient } from '@prisma/client';
import { removeMovie } from './movie-removal';

describe('removeMovie', () => {
  const deleteMany = () => jest.fn().mockResolvedValue({ count: 0 });
  const tx = {
    episodeAccess: { count: jest.fn() },
    streamingSession: { deleteMany: deleteMany() },
    studioMilestoneEvent: { deleteMany: deleteMany() },
    publication: { deleteMany: deleteMany() },
    contentReview: { deleteMany: deleteMany() },
    aiContentLabel: { deleteMany: deleteMany() },
    complianceCheck: { deleteMany: deleteMany() },
    episode: { updateMany: jest.fn() },
    mediaAsset: { deleteMany: deleteMany() },
    productionCostEntry: { deleteMany: deleteMany() },
    studioHandoff: { deleteMany: deleteMany() },
    auditLog: { deleteMany: deleteMany() },
    movie: { delete: jest.fn() },
  };

  beforeEach(() => jest.clearAllMocks());

  it('removes a movie nobody paid Coins for', async () => {
    tx.episodeAccess.count.mockResolvedValue(0);
    await removeMovie(tx as unknown as PrismaClient, 'm1');
    expect(tx.movie.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('refuses a movie with paid unlocks, which would vanish without the BR-52 refund', async () => {
    tx.episodeAccess.count.mockResolvedValue(2);
    await expect(removeMovie(tx as unknown as PrismaClient, 'm1')).rejects.toThrow(/2 paid unlock/);
    expect(tx.episodeAccess.count).toHaveBeenCalledWith({
      where: { episode: { movieId: 'm1' }, coinTransactionId: { not: null } },
    });
    expect(tx.movie.delete).not.toHaveBeenCalled();
  });
});
