import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { isAdult } from 'src/modules/identity/auth/credentials';
import { RecommendationResponseDto } from './recommendation-response.dto';

/** BR-68 — the hybrid weights: taste first, then what the platform watches, then what is new. */
const WEIGHTS = { genreAffinity: 0.4, countryAffinity: 0.2, popularity: 0.25, recency: 0.15 } as const;

const PAGE_SIZE = 20;

/** How far back a member's taste reaches (watch progress and likes). */
const TASTE_WINDOW_MS = 30 * 24 * 3600 * 1000;

/** Results are kept 6 hours per member before the scores are recomputed. */
const CACHE_TTL_MS = 6 * 3600 * 1000;

/** Age gate (BR-68, Điều 44 Luật Điện ảnh 134/2025/QH15): labels only confirmed adults may see. */
const AGE_GATE_LABELS = new Set(['T18']);

type CandidateMovie = {
  id: string;
  title: string;
  ageRating: string | null;
  posterUrl: string | null;
  country: string | null;
  releaseYear: number | null;
  genres: { genre: { name: string } }[];
};

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);
  private readonly cache = new Map<string, { at: number; rows: RecommendationResponseDto[] }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Member recommendations (BR-68): genre affinity is the share of each genre in what the member
   * watched and liked in the last 30 days, country affinity the share of each producing country,
   * popularity the platform-wide watch time and likes, recency the release year. T18 titles are
   * only scored for confirmed adults. Scores are cached 6 h per member.
   */
  async forYou(userId: string): Promise<RecommendationResponseDto[]> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } });
    if (!user) return [];
    const adult = user.dateOfBirth !== null && isAdult(user.dateOfBirth);
    const taste = await this.tasteOf(userId);

    const [movies, popularity] = await Promise.all([this.candidates(), this.popularityByMovie()]);
    const rows = movies
      .filter((m) => !taste.seen.has(m.id))
      .filter((m) => adult || !AGE_GATE_LABELS.has(m.ageRating ?? ''))
      .map((m) => ({ movie: m, score: this.score(m, taste, popularity.get(m.id) ?? 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PAGE_SIZE)
      .map((s) => RecommendationResponseDto.from(s.movie, s.score, 'hybrid'));

    this.cache.set(userId, { at: Date.now(), rows });
    return rows;
  }

  /**
   * Cold start (Guest): the trending AI sample films of the R2 catalog (`AI_Film/CATALOG.json`,
   * seeded into the movies table by `prisma/seed-catalog.ts`), ranked by platform-wide watch time
   * and likes. Guests never see a T18 title (BR-68).
   */
  async trending(): Promise<RecommendationResponseDto[]> {
    const [movies, popularity] = await Promise.all([this.candidates(), this.popularityByMovie()]);
    return movies
      .filter((m) => !AGE_GATE_LABELS.has(m.ageRating ?? ''))
      .map((m) => ({ movie: m, score: popularity.get(m.id) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PAGE_SIZE)
      .map((s) => RecommendationResponseDto.from(s.movie, s.score, 'trending'));
  }

  /** Movies with at least one published episode: the only ones a recommendation may point at. */
  private candidates(): Promise<CandidateMovie[]> {
    return this.prisma.movie.findMany({
      where: { episodes: { some: { status: 'PUBLISHED' } } },
      select: {
        id: true,
        title: true,
        ageRating: true,
        posterUrl: true,
        country: true,
        releaseYear: true,
        genres: { select: { genre: { select: { name: true } } } },
      },
    });
  }

  /** The member's last 30 days: genre and country shares, and the movies already seen or liked. */
  private async tasteOf(userId: string) {
    const since = new Date(Date.now() - TASTE_WINDOW_MS);
    const select = {
      select: {
        id: true,
        country: true,
        genres: { select: { genre: { select: { name: true } } } },
      },
    } as const;
    const [likes, progress] = await Promise.all([
      this.prisma.movieLike.findMany({ where: { userId }, select: { movie: select } }),
      this.prisma.watchProgress.findMany({
        where: { userId, updatedAt: { gte: since } },
        select: { episode: { select: { movie: select } } },
      }),
    ]);
    const watched = [...likes.map((l) => l.movie), ...progress.map((p) => p.episode.movie)];
    const genreShare = new Map<string, number>();
    const countryShare = new Map<string, number>();
    let genreTotal = 0;
    let countryTotal = 0;
    const seen = new Set<string>();
    for (const movie of watched) {
      seen.add(movie.id);
      for (const { genre } of movie.genres) {
        genreShare.set(genre.name, (genreShare.get(genre.name) ?? 0) + 1);
        genreTotal++;
      }
      if (movie.country) {
        countryShare.set(movie.country, (countryShare.get(movie.country) ?? 0) + 1);
        countryTotal++;
      }
    }
    return { seen, genreShare, genreTotal, countryShare, countryTotal };
  }

  private score(
    movie: CandidateMovie,
    taste: Awaited<ReturnType<RecommendationService['tasteOf']>>,
    popularity: number,
  ): number {
    return (
      WEIGHTS.genreAffinity * this.genreAffinity(movie, taste) +
      WEIGHTS.countryAffinity * this.countryAffinity(movie, taste) +
      WEIGHTS.popularity * popularity +
      WEIGHTS.recency * this.recency(movie.releaseYear)
    );
  }

  /** The best share among the movie's genres in the member's 30-day history, 0..1. */
  private genreAffinity(movie: CandidateMovie, taste: { genreShare: Map<string, number>; genreTotal: number }): number {
    if (!taste.genreTotal) return 0;
    const best = Math.max(0, ...movie.genres.map(({ genre }) => taste.genreShare.get(genre.name) ?? 0));
    return best / taste.genreTotal;
  }

  /** The share of the movie's producing country in the member's history, 0..1 (BR-68). */
  private countryAffinity(
    movie: CandidateMovie,
    taste: { countryShare: Map<string, number>; countryTotal: number },
  ): number {
    if (!movie.country || !taste.countryTotal) return 0;
    return (taste.countryShare.get(movie.country) ?? 0) / taste.countryTotal;
  }

  /** Movie popularity = total watch time + likes across its published episodes, normalized 0..1. */
  private async popularityByMovie(): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ movieId: string; total: bigint }[]>`
      SELECT e."movie_id" AS "movieId", COALESCE(SUM(s."total_watched_seconds"), 0) AS total
      FROM "episodes" e
      LEFT JOIN "episode_watch_stats" s ON s."episode_id" = e."id"
      WHERE e."status" = 'PUBLISHED'
      GROUP BY e."movie_id"
    `;
    const likes = await this.prisma.movieLike.groupBy({ by: ['movieId'], _count: { _all: true } });
    const likeMap = new Map(likes.map((l) => [l.movieId, l._count._all]));
    const values = rows.map((r) => Number(r.total) + (likeMap.get(r.movieId) ?? 0));
    const max = Math.max(1, ...values);
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.movieId, Math.min(1, (Number(r.total) + (likeMap.get(r.movieId) ?? 0)) / max));
    }
    return map;
  }

  private recency(releaseYear: number | null): number {
    if (!releaseYear) return 0;
    const age = new Date().getFullYear() - releaseYear;
    return Math.max(0, 1 - age / 20);
  }
}
