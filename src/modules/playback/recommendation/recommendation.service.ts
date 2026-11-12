import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { isAdult } from 'src/modules/identity/auth/credentials';
import { RecommendationResponseDto } from './recommendation-response.dto';
import {
  buildTaste,
  countryAffinity,
  genreAffinity,
  genreOverlap,
  reasonFor,
  TRENDING_REASON,
  type Taste,
} from './recommendation-taste';

/** BR-68 hybrid score: taste read from viewing behavior + platform popularity + recency. */
const WEIGHTS = { genreAffinity: 0.4, countryAffinity: 0.2, popularity: 0.25, recency: 0.15 } as const;
/** "Phim tương tự" on a movie page: overlap with that movie only. */
const SIMILAR_WEIGHTS = { genres: 0.6, country: 0.15, popularity: 0.25 } as const;
/** "Xem gì tiếp" right after a movie ends: like that movie, and like the member. */
const AFTER_WEIGHTS = { genres: 0.4, country: 0.1, taste: 0.3, popularity: 0.2 } as const;

const PAGE_SIZE = 20;
const SHORT_LIST = 12;
/** How far back viewing behavior shapes the taste. */
const TASTE_WINDOW_MS = 90 * 24 * 3600 * 1000;
const CACHE_TTL_MS = 6 * 3600 * 1000;
const AGE_GATE_LABELS = new Set(['T18']);

const MOVIE_TASTE = {
  select: { id: true, country: true, genres: { select: { genre: { select: { name: true } } } } },
} as const;

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
  private readonly cache = new Map<string, { at: number; stamp: string; rows: RecommendationResponseDto[] }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * "Dành cho bạn": genres and countries the member watches to the end score up, the ones they leave in the
   * first minutes score down; movies already opened are skipped and T18 is only for confirmed adults.
   */
  async forYou(userId: string): Promise<RecommendationResponseDto[]> {
    // A like or a watch since the last scoring makes the cached list stale at once, not after 6 h.
    const stamp = await this.tasteStamp(userId);
    const cached = this.cache.get(userId);
    if (cached && cached.stamp === stamp && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

    const adult = await this.isAdultViewer(userId);
    const [taste, movies, popularity] = await Promise.all([
      this.tasteOf(userId),
      this.candidates(),
      this.popularityByMovie(),
    ]);
    const rows = movies
      .filter((m) => !taste.seen.has(m.id) && this.allowed(m, adult))
      .map((m) => ({ movie: m, score: this.score(m, taste, popularity.get(m.id) ?? 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PAGE_SIZE)
      .map((s) => RecommendationResponseDto.from(s.movie, s.score, 'hybrid', reasonFor(s.movie, taste)));

    this.cache.set(userId, { at: Date.now(), stamp, rows });
    return rows;
  }

  /** Cold start (Guest): the catalog ranked by platform-wide watch time and likes, never T18 (BR-68). */
  async trending(): Promise<RecommendationResponseDto[]> {
    const [movies, popularity] = await Promise.all([this.candidates(), this.popularityByMovie()]);
    return movies
      .filter((m) => this.allowed(m, false))
      .map((m) => ({ movie: m, score: popularity.get(m.id) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PAGE_SIZE)
      .map((s) => RecommendationResponseDto.from(s.movie, s.score, 'trending', TRENDING_REASON));
  }

  /** "Phim tương tự" on a movie page: shared genres (Jaccard), same country and popularity. */
  async similar(movieId: string, viewerId?: string): Promise<RecommendationResponseDto[]> {
    const target = await this.target(movieId);
    const adult = viewerId ? await this.isAdultViewer(viewerId) : false;
    const [movies, popularity] = await Promise.all([this.candidates(), this.popularityByMovie()]);
    return movies
      .filter((m) => m.id !== movieId && this.allowed(m, adult))
      .map((m) => {
        const { shared, overlap } = genreOverlap(target, m);
        const sameCountry = !!m.country && m.country === target.country;
        const score =
          SIMILAR_WEIGHTS.genres * overlap +
          SIMILAR_WEIGHTS.country * (sameCountry ? 1 : 0) +
          SIMILAR_WEIGHTS.popularity * (popularity.get(m.id) ?? 0);
        const reason = shared.length ? `Cùng thể loại ${shared[0]}` : sameCountry ? `Cùng quốc gia ${m.country}` : null;
        return { movie: m, score, reason, related: shared.length > 0 || sameCountry };
      })
      .filter((s) => s.related)
      .sort((a, b) => b.score - a.score)
      .slice(0, SHORT_LIST)
      .map((s) => RecommendationResponseDto.from(s.movie, s.score, 'similar', s.reason));
  }

  /**
   * "AI đề xuất" under the player once a movie ends: close to the movie just watched and to the member's own
   * behavior, without what they already opened.
   */
  async after(movieId: string, userId: string): Promise<RecommendationResponseDto[]> {
    const target = await this.prisma.movie.findUnique({
      where: { id: movieId },
      select: { ...MOVIE_TASTE.select, title: true },
    });
    if (!target) throw new NotFoundException('Movie not found');
    const adult = await this.isAdultViewer(userId);
    const [taste, movies, popularity] = await Promise.all([
      this.tasteOf(userId),
      this.candidates(),
      this.popularityByMovie(),
    ]);
    return movies
      .filter((m) => m.id !== movieId && !taste.seen.has(m.id) && this.allowed(m, adult))
      .map((m) => {
        const { shared, overlap } = genreOverlap(target, m);
        const sameCountry = !!m.country && m.country === target.country;
        const personal = (genreAffinity(m, taste) + countryAffinity(m, taste)) / 2;
        const score =
          AFTER_WEIGHTS.genres * overlap +
          AFTER_WEIGHTS.country * (sameCountry ? 1 : 0) +
          AFTER_WEIGHTS.taste * personal +
          AFTER_WEIGHTS.popularity * (popularity.get(m.id) ?? 0);
        const reason = shared.length
          ? `Vì bạn vừa xem "${target.title}": cùng thể loại ${shared[0]}`
          : sameCountry
            ? `Vì bạn vừa xem "${target.title}": cùng quốc gia ${m.country}`
            : reasonFor(m, taste);
        return { movie: m, score, reason };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, SHORT_LIST)
      .map((s) => RecommendationResponseDto.from(s.movie, s.score, 'after', s.reason));
  }

  private async target(movieId: string) {
    const target = await this.prisma.movie.findUnique({ where: { id: movieId }, ...MOVIE_TASTE });
    if (!target) throw new NotFoundException('Movie not found');
    return target;
  }

  private async isAdultViewer(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } });
    return !!user?.dateOfBirth && isAdult(user.dateOfBirth);
  }

  private allowed(movie: CandidateMovie, adult: boolean): boolean {
    return adult || !AGE_GATE_LABELS.has(movie.ageRating ?? '');
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

  /** Likes plus the last 90 days of episode progress: how far into each movie the member got. */
  private async tasteOf(userId: string): Promise<Taste> {
    const since = new Date(Date.now() - TASTE_WINDOW_MS);
    const [likes, progress] = await Promise.all([
      this.prisma.movieLike.findMany({ where: { userId }, select: { movie: MOVIE_TASTE } }),
      this.prisma.watchProgress.findMany({
        where: { userId, updatedAt: { gte: since } },
        select: {
          positionSeconds: true,
          durationSeconds: true,
          completed: true,
          episode: { select: { targetDurationSeconds: true, movie: MOVIE_TASTE } },
        },
      }),
    ]);
    return buildTaste(
      likes.map((l) => l.movie),
      progress,
    );
  }

  /** Changes whenever the member likes a movie or watches an episode. */
  private async tasteStamp(userId: string): Promise<string> {
    const [likes, latest] = await Promise.all([
      this.prisma.movieLike.count({ where: { userId } }),
      this.prisma.watchProgress.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);
    return `${likes}:${latest?.updatedAt.getTime() ?? 0}`;
  }

  private score(movie: CandidateMovie, taste: Taste, popularity: number): number {
    return (
      WEIGHTS.genreAffinity * genreAffinity(movie, taste) +
      WEIGHTS.countryAffinity * countryAffinity(movie, taste) +
      WEIGHTS.popularity * popularity +
      WEIGHTS.recency * this.recency(movie.releaseYear)
    );
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
    const values = new Map(rows.map((r) => [r.movieId, Number(r.total) + (likeMap.get(r.movieId) ?? 0)]));
    const max = Math.max(1, ...values.values());
    return new Map([...values].map(([id, value]) => [id, Math.min(1, value / max)]));
  }

  private recency(releaseYear: number | null): number {
    if (!releaseYear) return 0;
    const age = new Date().getFullYear() - releaseYear;
    return Math.max(0, 1 - age / 20);
  }
}
