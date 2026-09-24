import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplianceResult, EpisodeProductionStatus, ReviewStatus, Prisma } from '@prisma/client';
import { PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/prisma/prisma.service';
import { complianceVerdict } from 'src/modules/compliance-check/compliance-verdict';
import { CreateCatalogRequestDto } from './dto/create-catalog.request.dto';
import { UpdateCatalogEpisodeRequestDto } from './dto/update-catalog-episode.request.dto';

// Viewer-facing reads only ever expose PUBLISHED episodes, and never the
// internal production data (packages, reviews, creators).
const PUBLISHED_EPISODES = {
  where: { productionStatus: EpisodeProductionStatus.PUBLISHED },
  orderBy: { episodeNumber: 'asc' },
} satisfies Prisma.Movie$episodesArgs;

const PUBLIC_MOVIE_INCLUDE = {
  genres: { include: { genre: true } },
  seasons: { orderBy: { seasonNumber: 'asc' } },
  episodes: PUBLISHED_EPISODES,
} satisfies Prisma.MovieInclude;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromPackage(packageId: string, dto: CreateCatalogRequestDto, createdById: string) {
    const pkg = await this.prisma.episodePackage.findUnique({
      where: { id: packageId },
      include: {
        productionPlan: true,
        complianceChecks: true,
        reviews: { where: { status: ReviewStatus.APPROVED } },
      },
    });
    if (!pkg) throw new NotFoundException(`Episode package with id "${packageId}" does not exist`);
    if (pkg.reviews.length === 0) {
      throw new ConflictException('The package must have an APPROVED review before entering the catalog');
    }
    if (complianceVerdict(pkg.complianceChecks) !== ComplianceResult.PASS) {
      throw new ConflictException(
        'Every compliance check of the package must PASS before it enters the catalog (BR-42)',
      );
    }

    const project = await this.prisma.productionProject.findUnique({
      where: { id: pkg.productionPlan.productionProjectId },
      include: { productionProjectGenres: true },
    });
    if (!project) throw new NotFoundException('Production project does not exist');

    // const user = await this.prisma.user.findUnique({ where: { id: dto.createdById } });
    // if (!user) throw new BadRequestException(`User with id "${dto.createdById}" does not exist`);

    const episodeNumber = dto.episodeNumber ?? pkg.productionPlan.episodeNumber;
    if (episodeNumber == null) {
      throw new BadRequestException('Episode number is required');
    }

    const episodeTitle = dto.episodeTitle ?? `${dto.title} - Tập ${episodeNumber}`;
    const genreIds = project.productionProjectGenres.map((g) => g.genreId);

    return this.prisma.$transaction(async (tx) => {
      const movie = await tx.movie.create({
        data: {
          title: dto.title,
          synopsis: dto.synopsis,
          description: dto.description,
          defaultLanguage: dto.defaultLanguage,
          createdById,
        },
      });

      if (genreIds.length > 0) {
        await tx.movieGenre.createMany({
          data: genreIds.map((genreId) => ({ movieId: movie.id, genreId })),
        });
      }

      let seasonId: string | undefined;
      if (dto.seasonNumber) {
        let season = await tx.season.findUnique({
          where: { movieId_seasonNumber: { movieId: movie.id, seasonNumber: dto.seasonNumber } },
        });
        if (!season) {
          season = await tx.season.create({ data: { movieId: movie.id, seasonNumber: dto.seasonNumber } });
        }
        seasonId = season.id;
      }

      await tx.episode.create({
        data: {
          movieId: movie.id,
          seasonId,
          episodeNumber,
          title: episodeTitle,
          productionStatus: EpisodeProductionStatus.DRAFT,
          currentPackageId: pkg.id,
        },
      });

      return tx.movie.findUnique({
        where: { id: movie.id },
        include: {
          genres: { include: { genre: true } },
          seasons: { include: { episodes: true } },
          episodes: { include: { currentPackage: true, publications: true } },
        },
      });
    });
  }

  async findAllMovies(query: PaginateQuery) {
    const where: Prisma.MovieWhereInput = { episodes: { some: PUBLISHED_EPISODES.where } };
    const title = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : null;
    if (title) where.title = { contains: title, mode: 'insensitive' };

    const extra = query.filter as Record<string, string> | Record<string, string[]> | undefined;
    const genreId = typeof extra?.genreId === 'string' ? extra.genreId : undefined;
    if (genreId) where.genres = { some: { genreId } };

    const limit = query.limit && query.limit > 0 && query.limit <= 100 ? query.limit : 20;
    const page = query.page && query.page > 0 ? query.page : 1;

    // Two plain reads — a batch $transaction adds nothing here and times out
    // waiting for a connection on the remote Neon pool.
    const [total, items] = await Promise.all([
      this.prisma.movie.count({ where }),
      this.prisma.movie.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: PUBLIC_MOVIE_INCLUDE,
      }),
    ]);

    return { items, total, page, limit };
  }

  async findMovieById(movieId: string) {
    const movie = await this.prisma.movie.findFirst({
      where: { id: movieId, episodes: { some: PUBLISHED_EPISODES.where } },
      include: PUBLIC_MOVIE_INCLUDE,
    });
    if (!movie) throw new NotFoundException(`Movie with id "${movieId}" does not exist`);
    return movie;
  }

  async findEpisodeById(episodeId: string) {
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        movie: { include: { genres: { include: { genre: true } } } },
        season: true,
        currentPackage: {
          include: {
            assets: { include: { generatedAsset: true } },
            reviews: true,
            complianceChecks: true,
            aiContentLabels: true,
          },
        },
        publications: { orderBy: { publishedAt: 'desc' } },
      },
    });
    if (!episode) throw new NotFoundException(`Episode with id "${episodeId}" does not exist`);
    return episode;
  }

  async updateEpisode(episodeId: string, dto: UpdateCatalogEpisodeRequestDto) {
    await this.findEpisodeById(episodeId);
    return this.prisma.episode.update({ where: { id: episodeId }, data: { title: dto.title } });
  }
}
