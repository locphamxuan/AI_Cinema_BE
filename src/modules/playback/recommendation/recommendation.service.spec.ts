import { RecommendationService } from './recommendation.service';
import { RecommendationResponseDto } from './recommendation-response.dto';

describe('RecommendationService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    movieLike: { findMany: jest.fn(), groupBy: jest.fn(), count: jest.fn() },
    watchProgress: { findMany: jest.fn(), findFirst: jest.fn() },
    savedMovie: { findMany: jest.fn(), count: jest.fn() },
    movie: { findMany: jest.fn(), findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  };
  /** A fresh service per test: results are cached 6 h per member. */
  const newService = () => new RecommendationService(prisma as never);

  const movie = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    title: 'The Last Starlight',
    ageRating: 'P',
    posterUrl: null,
    country: 'VN',
    releaseYear: 2025,
    genres: [{ genre: { name: 'Drama' } }],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.movieLike.groupBy.mockResolvedValue([]);
    prisma.movieLike.findMany.mockResolvedValue([]);
    prisma.watchProgress.findMany.mockResolvedValue([]);
    prisma.movieLike.count.mockResolvedValue(0);
    prisma.watchProgress.findFirst.mockResolvedValue(null);
    prisma.savedMovie.findMany.mockResolvedValue([]);
    prisma.savedMovie.count.mockResolvedValue(0);
  });

  it('returns recommendations for an adult member, age-gated', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movie.findMany.mockResolvedValue([movie()]);
    prisma.$queryRaw.mockResolvedValue([{ movieId: 'm1', total: 100n }]);

    const res = await newService().forYou('u1');
    expect(res[0]).toBeInstanceOf(RecommendationResponseDto);
    expect(res[0].source).toBe('hybrid');
    expect(res[0].movieId).toBe('m1');
  });

  it('filters out T18 films for members who are not 18', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('2010-01-01') });
    prisma.movie.findMany.mockResolvedValue([
      movie({ id: 'm1', ageRating: 'P' }),
      movie({ id: 'm2', ageRating: 'T18' }),
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { movieId: 'm1', total: 100n },
      { movieId: 'm2', total: 50n },
    ]);

    const res = await newService().forYou('u1');
    expect(res.map((r) => r.movieId)).toEqual(['m1']);
  });

  it('includes T18 films for members who are 18 or older', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movie.findMany.mockResolvedValue([
      movie({ id: 'm1', ageRating: 'P' }),
      movie({ id: 'm2', ageRating: 'T18' }),
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { movieId: 'm1', total: 100n },
      { movieId: 'm2', total: 50n },
    ]);

    const res = await newService().forYou('u1');
    expect(res.map((r) => r.movieId).sort()).toEqual(['m1', 'm2']);
  });

  it('scores the genres and the country the member actually watches (BR-68)', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    // The member watched a Vietnamese Drama; m-drama matches both, m-comedy neither.
    prisma.watchProgress.findMany.mockResolvedValue([
      {
        positionSeconds: 600,
        durationSeconds: 600,
        completed: true,
        episode: {
          targetDurationSeconds: 600,
          movie: { id: 'seen', country: 'VN', genres: [{ genre: { name: 'Drama' } }] },
        },
      },
    ]);
    prisma.movie.findMany.mockResolvedValue([
      movie({ id: 'm-drama', country: 'VN', genres: [{ genre: { name: 'Drama' } }] }),
      movie({ id: 'm-comedy', country: 'KR', genres: [{ genre: { name: 'Comedy' } }] }),
    ]);

    const res = await newService().forYou('u1');
    expect(res.map((r) => r.movieId)).toEqual(['m-drama', 'm-comedy']);
    expect(res[0].score).toBeGreaterThan(res[1].score);
  });

  it('never recommends what the member already watched or liked', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movieLike.findMany.mockResolvedValue([{ movie: { id: 'm1', country: null, genres: [] } }]);
    prisma.movie.findMany.mockResolvedValue([movie({ id: 'm1' }), movie({ id: 'm2' })]);

    const res = await newService().forYou('u1');
    expect(res.map((r) => r.movieId)).toEqual(['m2']);
  });

  it('caches a member result for the TTL window', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movie.findMany.mockResolvedValue([movie()]);
    const service = newService();
    await service.forYou('u1');
    await service.forYou('u1');
    expect(prisma.movie.findMany).toHaveBeenCalledTimes(1);
  });

  it('rescores at once after the member likes or watches something new (audit 2026-11-12)', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movie.findMany.mockResolvedValue([movie()]);
    const service = newService();
    await service.forYou('u1');
    prisma.movieLike.count.mockResolvedValue(1);
    await service.forYou('u1');
    // The taste is read again; the shared catalog snapshot is not.
    expect(prisma.movieLike.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.movie.findMany).toHaveBeenCalledTimes(1);
  });

  it('only names movies with an episode playable from R2 (published, not under revision, film READY and self-hosted)', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movie.findMany.mockResolvedValue([movie()]);
    await newService().trending();
    expect(prisma.movie.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          episodes: {
            some: {
              status: 'PUBLISHED',
              revisionStartedAt: null,
              approvedMediaAsset: { is: { ingestStatus: 'READY', isSelfHosted: true, streamUrl: { not: null } } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
    // The popularity SQL keeps to the same R2-playable episodes.
    const [[strings]] = prisma.$queryRaw.mock.calls as [[string[]]];
    const sql = strings.join('?');
    expect(sql).toContain('"is_self_hosted" = true');
    expect(sql).toContain(`"ingest_status" = 'READY'`);
    expect(sql).toContain('"revision_started_at" IS NULL');
  });

  it('reads saved movies as taste and never suggests them again', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.savedMovie.findMany.mockResolvedValue([
      { movie: { id: 'saved', country: 'KR', genres: [{ genre: { name: 'Horror' } }] } },
    ]);
    prisma.movie.findMany.mockResolvedValue([
      movie({ id: 'saved', genres: [{ genre: { name: 'Horror' } }], country: 'KR' }),
      movie({ id: 'horror', genres: [{ genre: { name: 'Horror' } }], country: 'US' }),
      movie({ id: 'drama', genres: [{ genre: { name: 'Drama' } }], country: 'US' }),
    ]);
    const res = await newService().forYou('u1');
    expect(res.map((r) => r.movieId)).toEqual(['horror', 'drama']);
    expect(res[0].reason).toBe('Hợp gu Horror bạn hay xem hết');
  });

  it('drops T18 from a cached list at once when the birthday changes to under 18', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movie.findMany.mockResolvedValue([movie({ id: 'p' }), movie({ id: 'adult', ageRating: 'T18' })]);
    const service = newService();
    expect((await service.forYou('u1')).map((r) => r.movieId).sort()).toEqual(['adult', 'p']);
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('2012-01-01') });
    expect((await service.forYou('u1')).map((r) => r.movieId)).toEqual(['p']);
  });

  it('drops a movie that left the catalog from a cached list once the catalog is read again', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movie.findMany.mockResolvedValue([movie({ id: 'a' }), movie({ id: 'gone' })]);
    const service = newService();
    expect(await service.forYou('u1')).toHaveLength(2);
    prisma.movie.findMany.mockResolvedValue([movie({ id: 'a' })]);
    now.mockReturnValue(1_000_000 + 6 * 60 * 1000); // past the 5-minute catalog snapshot, inside the 6 h list cache
    expect((await service.forYou('u1')).map((r) => r.movieId)).toEqual(['a']);
    now.mockRestore();
  });

  it('gives two members different picks after the same movie, from their own behaviour', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movie.findFirst.mockResolvedValue({
      id: 't',
      title: 'Phim A',
      country: 'VN',
      genres: [{ genre: { name: 'Drama' } }],
    });
    prisma.movie.findMany.mockResolvedValue([
      movie({
        id: 'drama-action',
        genres: [{ genre: { name: 'Drama' } }, { genre: { name: 'Action' } }],
        country: 'US',
      }),
      movie({
        id: 'drama-romance',
        genres: [{ genre: { name: 'Drama' } }, { genre: { name: 'Romance' } }],
        country: 'US',
      }),
    ]);
    const likes = (genre: string) => [
      { movie: { id: `liked-${genre}`, country: null, genres: [{ genre: { name: genre } }] } },
    ];
    const service = newService();
    prisma.movieLike.findMany.mockResolvedValueOnce(likes('Action'));
    const actionFan = await service.after('t', 'u-action');
    prisma.movieLike.findMany.mockResolvedValueOnce(likes('Romance'));
    const romanceFan = await service.after('t', 'u-romance');
    expect(actionFan[0].movieId).toBe('drama-action');
    expect(romanceFan[0].movieId).toBe('drama-romance');
  });

  it('explains a suggestion by the genre the member watches most', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movieLike.findMany.mockResolvedValue([
      { movie: { id: 'seen', country: 'KR', genres: [{ genre: { name: 'Drama' } }] } },
    ]);
    prisma.movie.findMany.mockResolvedValue([movie(), movie({ id: 'm2', genres: [], country: 'US' })]);
    const [first, second] = await newService().forYou('u1');
    expect(first.reason).toBe('Hợp gu Drama bạn hay xem hết');
    expect(second.reason).toBe('Đang thịnh hành trên AI Cinema');
  });

  it('suggests after a movie ends: close to it, unseen, with the reason', async () => {
    prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
    prisma.movie.findFirst.mockResolvedValue({
      id: 't',
      title: 'Phim A',
      country: 'VN',
      genres: [{ genre: { name: 'Drama' } }],
    });
    prisma.movieLike.findMany.mockResolvedValue([{ movie: { id: 'liked', country: null, genres: [] } }]);
    prisma.movie.findMany.mockResolvedValue([
      movie({ id: 't' }),
      movie({ id: 'liked' }),
      movie({ id: 'x', country: 'US', genres: [{ genre: { name: 'Action' } }] }),
      movie({ id: 'y' }),
    ]);
    const rows = await newService().after('t', 'u1');
    expect(rows.map((r) => r.movieId)).toEqual(['y', 'x']);
    expect(rows[0]).toMatchObject({ source: 'after', reason: 'Vì bạn vừa xem "Phim A": cùng thể loại Drama' });
    prisma.movie.findFirst.mockResolvedValue(null);
    await expect(newService().after('missing', 'u1')).rejects.toThrow('Movie not found');
  });

  describe('similar', () => {
    const target = { id: 't', country: 'VN', genres: [{ genre: { name: 'Drama' } }, { genre: { name: 'Romance' } }] };

    it('ranks movies sharing genres or country, never the movie itself, T18 hidden from guests', async () => {
      prisma.movie.findFirst.mockResolvedValue(target);
      prisma.movie.findMany.mockResolvedValue([
        movie({ id: 't' }),
        movie({ id: 'a', country: 'US' }),
        movie({ id: 'b', genres: [], country: 'VN' }),
        movie({ id: 'c', genres: [], country: 'US' }),
        movie({ id: 'd', ageRating: 'T18' }),
      ]);
      const rows = await newService().similar('t');
      expect(rows.map((r) => r.movieId)).toEqual(['a', 'b']);
      expect(rows[0]).toMatchObject({ source: 'similar', reason: 'Cùng thể loại Drama' });
      expect(rows[1].reason).toBe('Cùng quốc gia VN');
    });

    it('shows T18 titles to an adult viewer and 404s an unknown movie', async () => {
      prisma.movie.findFirst.mockResolvedValue(target);
      prisma.user.findUnique.mockResolvedValue({ dateOfBirth: new Date('1990-01-01') });
      prisma.movie.findMany.mockResolvedValue([movie({ id: 'd', ageRating: 'T18' })]);
      await expect(newService().similar('t', 'u1')).resolves.toHaveLength(1);
      prisma.movie.findFirst.mockResolvedValue(null);
      await expect(newService().similar('x')).rejects.toThrow('Movie not found');
    });
  });

  it('returns trending recommendations ranked by popularity, age-gated for cold starts', async () => {
    prisma.movie.findMany.mockResolvedValue([
      movie({ id: 'm1', ageRating: 'P' }),
      movie({ id: 'm2', ageRating: 'T18' }),
      movie({ id: 'm3', ageRating: 'P' }),
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { movieId: 'm1', total: 10n },
      { movieId: 'm3', total: 100n },
    ]);
    const res = await newService().trending();
    expect(res.map((r) => r.movieId)).toEqual(['m3', 'm1']);
    expect(res[0].source).toBe('trending');
  });
});
