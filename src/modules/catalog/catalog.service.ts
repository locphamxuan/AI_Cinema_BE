import { Injectable, NotFoundException } from '@nestjs/common';
import { EpisodeStatus, type Prisma } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform-setting/platform-setting.service';

/** Shown on an episode taken down to be fixed (BR-56). */
export const REVISION_NOTICE = 'Tập đang được bảo trì / sửa đổi nội dung';

/**
 * Episodes viewers see: released ones, and the ones taken down to be fixed, which stay listed
 * with a maintenance notice (BR-56). Scheduled, removed and unfinished episodes stay hidden.
 */
const VISIBLE_EPISODE: Prisma.EpisodeWhereInput = {
  OR: [{ status: EpisodeStatus.PUBLISHED }, { revisionStartedAt: { not: null } }],
};

/** A movie is listed once one of its episodes is out (MF-1 step 14). */
const LISTED_MOVIE: Prisma.MovieWhereInput = { episodes: { some: VISIBLE_EPISODE } };

const GENRES = { genres: { include: { genre: { select: { id: true, name: true } } } } };

const EPISODE_DETAIL = {
  season: { select: { seasonNumber: true, title: true } },
  approvedMediaAsset: {
    select: {
      durationSeconds: true,
      qualities: true,
      aiContentLabel: { select: { labelType: true, labelText: true, displayLocation: true } },
    },
  },
  publications: {
    where: { publishedAt: { not: null } },
    orderBy: { publishedAt: 'desc' },
    take: 1,
    select: { publishedAt: true },
  },
} satisfies Prisma.EpisodeInclude;

type MovieRow = Prisma.MovieGetPayload<{ include: typeof GENRES }>;
type EpisodeRow = Prisma.EpisodeGetPayload<{ include: typeof EPISODE_DETAIL }>;

/**
 * The public catalog Guests and Members browse (BR-07). Only catalog fields leave this
 * service: never the studio, the fee, the people in charge or the idea, and never a stream
 * URL, which playback hands out after checking access (MF-3).
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
  ) {}

  async listMovies(query: PaginateQuery, genreId?: string) {
    const page = await paginate(query, this.prisma.movie, {
      where: genreId ? { ...LISTED_MOVIE, genres: { some: { genreId } } } : LISTED_MOVIE,
      relations: GENRES,
      sortableColumns: ['title', 'releaseYear', 'createdAt'],
      defaultSortBy: [['createdAt', 'DESC']],
      searchableColumns: ['title'],
      filterableColumns: { ageRating: ['$eq', '$in'], releaseYear: ['$eq', '$gte', '$lte'] },
    });
    return { ...page, data: (page.data as MovieRow[]).map(movieCard) };
  }

  async movie(movieId: string) {
    const movie = await this.prisma.movie.findFirst({ where: { id: movieId, ...LISTED_MOVIE }, include: GENRES });
    if (!movie) throw new NotFoundException('Movie not found');
    const seasons = await this.seasons(movieId);
    return {
      ...movieCard(movie),
      seasons,
      episodeCount: seasons.reduce((sum, season) => sum + season.episodeCount, 0),
    };
  }

  /** Seasons that have something to show, with how many episodes they show. */
  async seasons(movieId: string) {
    await this.assertListed(movieId);
    const seasons = await this.prisma.season.findMany({
      where: { movieId, episodes: { some: VISIBLE_EPISODE } },
      orderBy: { seasonNumber: 'asc' },
      select: { seasonNumber: true, title: true, _count: { select: { episodes: { where: VISIBLE_EPISODE } } } },
    });
    return seasons.map(({ _count, ...season }) => ({ ...season, episodeCount: _count.episodes }));
  }

  async episodes(movieId: string, seasonNumber?: number) {
    await this.assertListed(movieId);
    const [episodes, freeStarter] = await Promise.all([
      this.prisma.episode.findMany({
        where: { movieId, ...VISIBLE_EPISODE, ...(seasonNumber ? { season: { seasonNumber } } : {}) },
        orderBy: { episodeNumber: 'asc' },
        include: EPISODE_DETAIL,
      }),
      this.freeStarterCount(),
    ]);
    return episodes.map((episode) => episodeView(episode, freeStarter));
  }

  async episode(episodeId: string) {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, ...VISIBLE_EPISODE },
      include: { ...EPISODE_DETAIL, movie: { include: GENRES } },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return { ...episodeView(episode, await this.freeStarterCount()), movie: movieCard(episode.movie) };
  }

  private async assertListed(movieId: string) {
    if (!(await this.prisma.movie.count({ where: { id: movieId, ...LISTED_MOVIE } }))) {
      throw new NotFoundException('Movie not found');
    }
  }

  private async freeStarterCount(): Promise<number> {
    return (await this.settings.get()).freeStarterEpisodeCount;
  }
}

export function movieCard(movie: MovieRow) {
  return {
    id: movie.id,
    title: movie.title,
    synopsis: movie.synopsis,
    ageRating: movie.ageRating,
    releaseYear: movie.releaseYear,
    defaultLanguage: movie.defaultLanguage,
    posterUrl: movie.posterUrl,
    bannerUrl: movie.bannerUrl,
    trailerUrl: movie.trailerUrl,
    // The whole catalog is AI-made; the per-episode label says how (BR-40).
    aiGenerated: movie.aiGenerated,
    genres: movie.genres.map(({ genre }) => genre),
  };
}

/**
 * What a viewer sees of an episode. Under revision it shows the notice and can't be played;
 * its AI label and length come back with the fixed version (BR-56).
 */
export function episodeView(episode: EpisodeRow, freeStarterCount: number) {
  const underRevision = episode.revisionStartedAt !== null;
  const media = underRevision ? null : episode.approvedMediaAsset;
  return {
    id: episode.id,
    movieId: episode.movieId,
    seasonNumber: episode.season.seasonNumber,
    seasonTitle: episode.season.title,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    synopsis: episode.synopsis,
    thumbnailUrl: episode.thumbnailUrl,
    availability: underRevision ? 'UNDER_REVISION' : 'AVAILABLE',
    notice: underRevision ? REVISION_NOTICE : null,
    // BR-03: the first episodes of every movie, counted across seasons.
    isFreeStarter: episode.episodeNumber <= freeStarterCount,
    coinPrice: episode.coinPrice,
    durationSeconds: media?.durationSeconds ?? null,
    qualities: media?.qualities ?? [],
    aiLabel: media?.aiContentLabel ?? null,
    publishedAt: episode.publications[0]?.publishedAt ?? null,
  };
}
