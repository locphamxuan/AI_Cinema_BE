import { Injectable } from '@nestjs/common';
import { AccessSource } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { GENRES, LISTED_MOVIE } from '../catalog.service';
import { VISIBLE_EPISODE } from '../episode-visibility';

interface EpisodeFigures {
  views: number;
  purchases: number;
  /** Coin Members paid to unlock the episode, minus what was refunded when it was taken down. */
  coinsEarned: number;
  refundedCoins: number;
}

const ZERO: EpisodeFigures = { views: 0, purchases: 0, coinsEarned: 0, refundedCoins: 0 };

/**
 * The Admin's film management: every movie on the platform with its hearts, plays and the Coin Members paid
 * for its episodes, movie by movie and episode by episode; narrowed to one genre when asked.
 */
@Injectable()
export class FilmReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Genres that have at least one movie on the platform, for the Admin's tabs. */
  async genres() {
    const genres = await this.prisma.genre.findMany({
      where: { movies: { some: { movie: LISTED_MOVIE } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, _count: { select: { movies: { where: { movie: LISTED_MOVIE } } } } },
    });
    return genres.map(({ _count, ...genre }) => ({ ...genre, movieCount: _count.movies }));
  }

  async movies(genreId?: string) {
    const movies = await this.prisma.movie.findMany({
      where: genreId ? { ...LISTED_MOVIE, genres: { some: { genreId } } } : LISTED_MOVIE,
      orderBy: { title: 'asc' },
      include: {
        ...GENRES,
        _count: { select: { likes: true } },
        episodes: {
          where: VISIBLE_EPISODE,
          orderBy: { episodeNumber: 'asc' },
          select: { id: true, episodeNumber: true, title: true, coinPrice: true, status: true },
        },
      },
    });
    const figures = await this.episodeFigures(movies.flatMap((m) => m.episodes.map((e) => e.id)));
    return movies.map((movie) => {
      const episodes = movie.episodes.map((e) => ({ ...e, ...(figures.get(e.id) ?? ZERO) }));
      const sum = (key: keyof EpisodeFigures) => episodes.reduce((n, e) => n + e[key], 0);
      return {
        id: movie.id,
        title: movie.title,
        posterUrl: movie.posterUrl,
        status: movie.status,
        releaseYear: movie.releaseYear,
        ageRating: movie.ageRating,
        genres: movie.genres.map(({ genre }) => genre),
        likeCount: movie._count.likes,
        viewCount: sum('views'),
        purchases: sum('purchases'),
        coinsEarned: sum('coinsEarned'),
        refundedCoins: sum('refundedCoins'),
        episodes,
      };
    });
  }

  private async episodeFigures(episodeIds: string[]): Promise<Map<string, EpisodeFigures>> {
    const where = { episodeId: { in: episodeIds }, source: AccessSource.EPISODE_PURCHASE };
    const [views, bought, refunded] = await Promise.all([
      this.prisma.episodeView.groupBy({
        by: ['episodeId'],
        where: { episodeId: { in: episodeIds } },
        _count: { _all: true },
      }),
      this.prisma.episodeAccess.groupBy({
        by: ['episodeId'],
        where,
        _count: { _all: true },
        _sum: { paidCoins: true },
      }),
      this.prisma.episodeAccess.groupBy({
        by: ['episodeId'],
        where: { ...where, revokedAt: { not: null } },
        _sum: { paidCoins: true },
      }),
    ]);
    const result = new Map<string, EpisodeFigures>();
    const row = (id: string) => result.get(id) ?? result.set(id, { ...ZERO }).get(id)!;
    for (const v of views) row(v.episodeId).views = v._count._all;
    for (const b of bought) {
      row(b.episodeId).purchases = b._count._all;
      row(b.episodeId).coinsEarned = b._sum.paidCoins ?? 0;
    }
    for (const r of refunded) {
      const figures = row(r.episodeId);
      figures.refundedCoins = r._sum.paidCoins ?? 0;
      figures.coinsEarned -= figures.refundedCoins;
    }
    return result;
  }
}
