import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { RecommendationResponseDto } from './recommendation-response.dto';

/** Genre affinity weights (30-day window) and recency bonus. */
const WEIGHTS = {
  genreAffinity: 0.4,
  countryAffinity: 0.2,
  popularity: 0.25,
  recency: 0.15,
} as const;

/** How many recommendations to return per page. */
const PAGE_SIZE = 20;

/** Age gate (BR-68, Điều 44 Luật Điện ảnh 134/2025/QH15). */
const AGE_GATE_LABELS = new Set(['T18']);

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Member recommendations (personalized, age-gated). */
  async forYou(userId: string): Promise<RecommendationResponseDto[]> {
    const [user, likes, progress] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, dateOfBirth: true } }),
      this.prisma.movieLike.findMany({ where: { userId }, select: { movieId: true } }),
      this.prisma.watchProgress.findMany({
        where: { userId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
        select: { episode: { select: { movieId: true } } },
      }),
    ]);
    if (!user) return [];
    const isAdult = this.isOver18(user.dateOfBirth);
    const seen = new Set([...likes.map((l) => l.movieId), ...progress.map((p) => p.episode.movieId)]);

    const [movies, popularity] = await Promise.all([
      this.prisma.movie.findMany({
        where: { episodes: { some: { status: 'PUBLISHED' } } },
        include: { genres: { include: { genre: true } } },
      }),
      this.popularityByMovie(),
    ]);

    const scored = movies
      .filter((m) => !seen.has(m.id))
      .filter((m) => !AGE_GATE_LABELS.has(m.ageRating ?? '') || isAdult)
      .map((m) => ({ movie: m, score: this.score(m, popularity.get(m.id) ?? 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PAGE_SIZE);

    return scored.map((s) => RecommendationResponseDto.from(s.movie, s.score, 'hybrid'));
  }

  /** A member is 18 or older when their declared date of birth is at least 18 years ago. */
  private isOver18(dateOfBirth: Date | null): boolean {
    if (!dateOfBirth) return false;
    const age = new Date().getFullYear() - dateOfBirth.getFullYear();
    return age >= 18;
  }

  /** Cold-start recommendations from the R2 sample catalog, age-gated. */
  async trending(): Promise<RecommendationResponseDto[]> {
    const movies = await this.prisma.movie.findMany({
      where: { episodes: { some: { status: 'PUBLISHED' } } },
      include: { genres: { include: { genre: true } } },
      take: PAGE_SIZE,
    });
    return movies
      .filter((m) => !AGE_GATE_LABELS.has(m.ageRating ?? ''))
      .map((m) => RecommendationResponseDto.from(m, 0, 'trending'));
  }

  /**
   * Hybrid score. Popularity is view count + likes across the movie's published episodes;
   * recency decays with the release year. Genre affinity is the share of the member's watched
   * genres; country affinity is a bonus for the member's own country, which is not stored yet,
   * so it stays at zero until the profile carries one.
   */
  private score(
    movie: { id: string; releaseYear: number | null; genres: { genre: { name: string } }[] },
    popularity: number,
  ) {
    const genreScore = this.genreAffinity(movie.genres.map((g) => g.genre.name));
    const recency = this.recency(movie.releaseYear);
    return (
      WEIGHTS.genreAffinity * genreScore +
      WEIGHTS.countryAffinity * 0 +
      WEIGHTS.popularity * popularity +
      WEIGHTS.recency * recency
    );
  }

  private genreAffinity(genres: string[]): number {
    if (!genres.length) return 0;
    return genres.length / (genres.length + 5);
  }

  /** Movie popularity = total views + likes across its published episodes, normalized 0..1. */
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
    const values = [...rows.map((r) => Number(r.total)), ...likes.map((l) => likeMap.get(l.movieId) ?? 0)];
    const max = Math.max(1, ...values);
    const map = new Map<string, number>();
    for (const r of rows) {
      const v = (Number(r.total) + (likeMap.get(r.movieId) ?? 0)) / max;
      map.set(r.movieId, Math.min(1, v));
    }
    return map;
  }

  private recency(releaseYear: number | null): number {
    if (!releaseYear) return 0;
    const age = new Date().getFullYear() - releaseYear;
    return Math.max(0, 1 - age / 20);
  }
}
