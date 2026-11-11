import { RecommendationService } from './recommendation.service';
import { RecommendationResponseDto } from './recommendation-response.dto';

describe('RecommendationService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    movieLike: { findMany: jest.fn(), groupBy: jest.fn() },
    watchProgress: { findMany: jest.fn() },
    movie: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const service = new RecommendationService(prisma as never);

  const movie = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    title: 'The Last Starlight',
    ageRating: 'P',
    releaseYear: 2025,
    genres: [{ genre: { name: 'Drama' } }],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.movieLike.groupBy.mockResolvedValue([]);
  });

  it('returns recommendations for an adult member, age-gated', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movieLike.findMany.mockResolvedValue([]);
    prisma.watchProgress.findMany.mockResolvedValue([]);
    prisma.movie.findMany.mockResolvedValue([movie()]);
    prisma.$queryRaw.mockResolvedValue([{ movieId: 'm1', total: 100n }]);

    const res = await service.forYou('u1');
    expect(res[0]).toBeInstanceOf(RecommendationResponseDto);
    expect(res[0].source).toBe('hybrid');
    expect(res[0].movieId).toBe('m1');
  });

  it('filters out T18 films for members who are not 18', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('2010-01-01') });
    prisma.movieLike.findMany.mockResolvedValue([]);
    prisma.watchProgress.findMany.mockResolvedValue([]);
    prisma.movie.findMany.mockResolvedValue([
      movie({ id: 'm1', ageRating: 'P' }),
      movie({ id: 'm2', ageRating: 'T18' }),
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { movieId: 'm1', total: 100n },
      { movieId: 'm2', total: 50n },
    ]);

    const res = await service.forYou('u1');
    expect(res.map((r) => r.movieId)).toEqual(['m1']);
  });

  it('includes T18 films for members who are 18 or older', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movieLike.findMany.mockResolvedValue([]);
    prisma.watchProgress.findMany.mockResolvedValue([]);
    prisma.movie.findMany.mockResolvedValue([
      movie({ id: 'm1', ageRating: 'P' }),
      movie({ id: 'm2', ageRating: 'T18' }),
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { movieId: 'm1', total: 100n },
      { movieId: 'm2', total: 50n },
    ]);

    const res = await service.forYou('u1');
    expect(res.map((r) => r.movieId).sort()).toEqual(['m1', 'm2']);
  });

  it('returns trending recommendations, age-gated for cold starts', async () => {
    prisma.movie.findMany.mockResolvedValue([
      movie({ id: 'm1', ageRating: 'P' }),
      movie({ id: 'm2', ageRating: 'T18' }),
    ]);
    const res = await service.trending();
    expect(res.map((r) => r.movieId)).toEqual(['m1']);
    expect(res[0].source).toBe('trending');
  });
});
