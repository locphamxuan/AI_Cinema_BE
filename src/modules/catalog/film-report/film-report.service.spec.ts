import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { FilmReportService } from './film-report.service';

describe('FilmReportService.movies', () => {
  it('adds up plays and Coin per episode and per movie, net of refunds', async () => {
    const prisma = {
      movie: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            title: 'Vùng dịch 704',
            posterUrl: null,
            status: 'COMPLETED',
            releaseYear: 2026,
            ageRating: 'T16',
            genres: [{ genre: { id: 'g1', name: 'Kinh dị' } }],
            _count: { likes: 4 },
            episodes: [
              { id: 'e1', episodeNumber: 1, title: 'Tập 1', coinPrice: 0, status: 'PUBLISHED' },
              { id: 'e2', episodeNumber: 2, title: 'Tập 2', coinPrice: 3, status: 'PUBLISHED' },
            ],
          },
        ]),
      },
      episodeView: {
        groupBy: jest.fn().mockResolvedValue([
          { episodeId: 'e1', _count: { _all: 10 } },
          { episodeId: 'e2', _count: { _all: 6 } },
        ]),
      },
      episodeAccess: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([{ episodeId: 'e2', _count: { _all: 5 }, _sum: { paidCoins: 15 } }])
          .mockResolvedValueOnce([{ episodeId: 'e2', _sum: { paidCoins: 3 } }]),
      },
    };
    const [movie] = await new FilmReportService(prisma as unknown as PrismaService).movies('g1');

    expect(movie).toMatchObject({ likeCount: 4, viewCount: 16, purchases: 5, coinsEarned: 12, refundedCoins: 3 });
    expect(movie.episodes[0]).toMatchObject({ episodeNumber: 1, views: 10, purchases: 0, coinsEarned: 0 });
    expect(movie.episodes[1]).toMatchObject({ episodeNumber: 2, views: 6, purchases: 5, coinsEarned: 12 });
  });
});
