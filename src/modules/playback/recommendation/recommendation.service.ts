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
import { LISTED, loadCandidates, loadPopularity, type CandidateMovie } from './recommendation-catalog';

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
/** The candidate movies and their popularity are shared by every viewer and read again after this. */
const CATALOG_TTL_MS = 5 * 60 * 1000;
const AGE_GATE_LABELS = new Set(['T18']);
/** Members whose list stays cached; the oldest entry goes first when full. */
const CACHE_MAX_MEMBERS = 5000;

const MOVIE_TASTE = {
  select: { id: true, country: true, genres: { select: { genre: { select: { name: true } } } } },
} as const;

@Injectable()
export class RecommendationService {
  private readonly cache = new Map<string, { at: number; stamp: string; rows: RecommendationResponseDto[] }>();
  private snapshot?: { at: number; movies: CandidateMovie[]; popularity: Map<string, number> };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * "Dành cho bạn": genres and countries the member watches to the end score up, the ones they leave in the
   * first minutes score down; movies already opened are skipped and T18 is only for confirmed adults.
   */
  async forYou(userId: string): Promise<RecommendationResponseDto[]> {
    // A like, a save, a watch or a birthday change since the last scoring makes the cached list stale at once.
    const adult = await this.isAdultViewer(userId);
    const stamp = `${adult ? 'adult' : 'minor'}:${await this.tasteStamp(userId)}`;
    const { movies, popularity } = await this.catalog();
    const cached = this.cache.get(userId);
    if (cached && cached.stamp === stamp && Date.now() - cached.at < CACHE_TTL_MS) {
      // A movie taken off the catalog or relabelled T18 since then drops out of the cached list too.
      const still = new Map(movies.map((m) => [m.id, m]));
      return cached.rows.filter((row) => {
        const movie = still.get(row.movieId);
        return !!movie && this.allowed(movie, adult);
      });
    }

    const taste = await this.tasteOf(userId);
    const rows = movies
      .filter((m) => !taste.seen.has(m.id) && this.allowed(m, adult))
      .map((m) => ({ movie: m, score: this.score(m, taste, popularity.get(m.id) ?? 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PAGE_SIZE)
      .map((s) => RecommendationResponseDto.from(s.movie, s.score, 'hybrid', reasonFor(s.movie, taste)));

    this.cache.delete(userId);
    const [oldest] = this.cache.keys();
    if (this.cache.size >= CACHE_MAX_MEMBERS && oldest) this.cache.delete(oldest);
    this.cache.set(userId, { at: Date.now(), stamp, rows });
    return rows;
  }

  /** Cold start (Guest): the catalog ranked by platform-wide watch time and likes, never T18 (BR-68). */
  async trending(): Promise<RecommendationResponseDto[]> {
    const { movies, popularity } = await this.catalog();
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
    const { movies, popularity } = await this.catalog();
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
    const target = await this.prisma.movie.findFirst({
      where: { id: movieId, ...LISTED },
      select: { ...MOVIE_TASTE.select, title: true },
    });
    if (!target) throw new NotFoundException('Movie not found');
    const adult = await this.isAdultViewer(userId);
    const [taste, { movies, popularity }] = await Promise.all([this.tasteOf(userId), this.catalog()]);
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

  /** Only a movie on the catalog (a published episode): an unreleased or cancelled one stays unknown. */
  private async target(movieId: string) {
    const target = await this.prisma.movie.findFirst({ where: { id: movieId, ...LISTED }, ...MOVIE_TASTE });
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

  /** Candidate movies (R2-playable only) and their popularity, shared by every viewer for a few minutes. */
  private async catalog(): Promise<{ movies: CandidateMovie[]; popularity: Map<string, number> }> {
    if (this.snapshot && Date.now() - this.snapshot.at < CATALOG_TTL_MS) return this.snapshot;
    const [movies, popularity] = await Promise.all([loadCandidates(this.prisma), loadPopularity(this.prisma)]);
    this.snapshot = { at: Date.now(), movies, popularity };
    return this.snapshot;
  }

  /** Likes, saved movies and the last 90 days of episode progress: how far into each movie the member got. */
  private async tasteOf(userId: string): Promise<Taste> {
    const since = new Date(Date.now() - TASTE_WINDOW_MS);
    const [likes, saved, progress] = await Promise.all([
      this.prisma.movieLike.findMany({ where: { userId }, select: { movie: MOVIE_TASTE } }),
      this.prisma.savedMovie.findMany({ where: { userId }, select: { movie: MOVIE_TASTE } }),
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
      saved.map((s) => s.movie),
    );
  }

  /** Changes whenever the member likes or saves a movie or watches an episode. */
  private async tasteStamp(userId: string): Promise<string> {
    const [likes, saved, latest] = await Promise.all([
      this.prisma.movieLike.count({ where: { userId } }),
      this.prisma.savedMovie.count({ where: { userId } }),
      this.prisma.watchProgress.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);
    return `${likes}:${saved}:${latest?.updatedAt.getTime() ?? 0}`;
  }

  private score(movie: CandidateMovie, taste: Taste, popularity: number): number {
    return (
      WEIGHTS.genreAffinity * genreAffinity(movie, taste) +
      WEIGHTS.countryAffinity * countryAffinity(movie, taste) +
      WEIGHTS.popularity * popularity +
      WEIGHTS.recency * this.recency(movie.releaseYear)
    );
  }

  private recency(releaseYear: number | null): number {
    if (!releaseYear) return 0;
    const age = new Date().getFullYear() - releaseYear;
    return Math.max(0, 1 - age / 20);
  }
}
