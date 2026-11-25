import { freeTierOf } from './episode-free-tier';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectStatus, type Prisma } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { EPISODE_AVAILABILITY, REVISION_NOTICE, VISIBLE_EPISODE } from './episode-visibility';
import { blendPopularity } from './popularity';

/** A movie is listed once one of its episodes is out (MF-1 step 14), never once cancelled. */
export const LISTED_MOVIE: Prisma.MovieWhereInput = {
  project: { status: { not: ProjectStatus.CANCELLED } },
  episodes: { some: VISIBLE_EPISODE },
};

/** Names of subtitle languages as the player lists them. */
const SUBTITLE_LABEL: Record<string, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
  zh: '中文',
  ko: '한국어',
  ja: '日本語',
  fr: 'Français',
};

export const GENRES = { genres: { include: { genre: { select: { id: true, name: true } } } } };

/** A card of the movie list also counts the episodes viewers can see, the same ones `/movies/:id/episodes` lists. */
const LISTED_CARD = {
  ...GENRES,
  _count: { select: { episodes: { where: VISIBLE_EPISODE } } },
} satisfies Prisma.MovieInclude;

/** How many movies the ranking tab shows. */
const RANKING_SIZE = 20;
/** Highest season number a catalog filter accepts. */
const MAX_SEASON_NUMBER = 1000;

const EPISODE_DETAIL = {
  season: { select: { seasonNumber: true, title: true } },
  approvedMediaAsset: {
    select: {
      durationSeconds: true,
      qualities: true,
      subtitles: {
        orderBy: [{ isDefault: 'desc' }, { language: 'asc' }],
        select: { id: true, language: true, isDefault: true },
      },
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
type ListedRow = Prisma.MovieGetPayload<{ include: typeof LISTED_CARD }>;
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
      relations: LISTED_CARD,
      sortableColumns: ['title', 'releaseYear', 'createdAt'],
      defaultSortBy: [['createdAt', 'DESC']],
      searchableColumns: ['title'],
      filterableColumns: { ageRating: ['$eq', '$in'], releaseYear: ['$eq', '$gte', '$lte'] },
    });
    return {
      ...page,
      data: (page.data as ListedRow[]).map((movie) => ({ ...movieCard(movie), episodeCount: movie._count.episodes })),
    };
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

  /**
   * The ranking tab: listed movies by plays of their episodes (the viewCount viewers see under a
   * movie) and hearts, each scaled to the top movie (`blendPopularity`), most first. Ties keep the
   * newer movie first.
   */
  async ranking(limit = RANKING_SIZE) {
    const movies = await this.prisma.movie.findMany({
      where: LISTED_MOVIE,
      orderBy: { createdAt: 'desc' },
      include: {
        ...GENRES,
        _count: { select: { likes: true } },
        episodes: { select: { _count: { select: { views: true } } } },
      },
    });
    const cards = movies.map((movie) => ({
      ...movieCard(movie),
      viewCount: movie.episodes.reduce((sum, e) => sum + e._count.views, 0),
      likeCount: movie._count?.likes ?? 0,
    }));
    const score = blendPopularity(cards.map((c) => ({ id: c.id, views: c.viewCount, likes: c.likeCount })));
    return cards.sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0)).slice(0, limit);
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
    // `?season=` reaches an integer column: a value it cannot hold is a bad request, never a database error.
    if (seasonNumber !== undefined && (seasonNumber < 1 || seasonNumber > MAX_SEASON_NUMBER)) {
      throw new BadRequestException({
        message: `season must be between 1 and ${MAX_SEASON_NUMBER}`,
        details: { reason: 'SEASON_NUMBER_INVALID' },
      });
    }
    await this.assertListed(movieId);
    const episodes = await this.prisma.episode.findMany({
      where: { movieId, ...VISIBLE_EPISODE, ...(seasonNumber !== undefined ? { season: { seasonNumber } } : {}) },
      orderBy: { episodeNumber: 'asc' },
      include: EPISODE_DETAIL,
    });
    return episodes.map((episode) => episodeView(episode));
  }

  async episode(episodeId: string) {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, ...VISIBLE_EPISODE },
      include: { ...EPISODE_DETAIL, movie: { include: GENRES } },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return {
      ...episodeView(episode),
      movie: movieCard(episode.movie),
    };
  }

  private async assertListed(movieId: string) {
    const movie = await this.prisma.movie.findFirst({
      where: { id: movieId, ...LISTED_MOVIE },
      select: { id: true },
    });
    if (!movie) throw new NotFoundException('Movie not found');
    return movie;
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
export function episodeView(episode: EpisodeRow) {
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
    availability: underRevision ? EPISODE_AVAILABILITY.UNDER_REVISION : EPISODE_AVAILABILITY.AVAILABLE,
    notice: underRevision ? REVISION_NOTICE : null,
    // BR-03: the Admin's per-episode flags; isFreeStarter (free without an account) is kept for older clients.
    isFreeStarter: freeTierOf(episode).forGuest,
    isFreeForGuest: freeTierOf(episode).forGuest,
    isFreeForMember: freeTierOf(episode).forMember,
    coinPrice: episode.coinPrice,
    durationSeconds: media?.durationSeconds ?? null,
    qualities: media?.qualities ?? [],
    aiLabel: media?.aiContentLabel ?? null,
    // Served through the API (GET /subtitles/:id) so the web player gets them without storage CORS.
    subtitles: (media?.subtitles ?? []).map((s) => ({
      id: s.id,
      language: s.language,
      label: SUBTITLE_LABEL[s.language] ?? s.language,
      isDefault: s.isDefault,
    })),
    publishedAt: episode.publications[0]?.publishedAt ?? null,
  };
}
