import { ComplianceCheckType, ComplianceResult, ProductionContentType, ReviewStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CatalogService } from './catalog.service';

const passedChecks = Object.values(ComplianceCheckType).map((checkType) => ({
  checkType,
  result: ComplianceResult.PASS,
}));

/** The `data` a Prisma create/update mock was last called with. */
const dataOf = (fn: jest.Mock) => (fn.mock.calls.at(-1) as [{ data: Record<string, unknown> }])[0].data;

describe('CatalogService.createFromPackage', () => {
  const tx = {
    movie: { create: jest.fn(), findUnique: jest.fn() },
    movieGenre: { createMany: jest.fn() },
    productionProject: { update: jest.fn() },
    season: { upsert: jest.fn() },
    episode: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    episodePackage: { findUnique: jest.fn() },
    productionProject: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new CatalogService(prisma as unknown as PrismaService);

  const givenProject = (overrides: object = {}) =>
    prisma.productionProject.findUnique.mockResolvedValue({
      id: 'project-id',
      title: 'Saigon 2077',
      description: 'Phim AI',
      contentType: ProductionContentType.SERIES,
      movieId: null,
      productionProjectGenres: [{ genreId: 'genre-id' }],
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.episodePackage.findUnique.mockResolvedValue({
      id: 'package-id',
      productionPlan: { productionProjectId: 'project-id', seasonNumber: 2, seasonEpisodeNumber: 3 },
      complianceChecks: passedChecks,
      reviews: [{ status: ReviewStatus.APPROVED }],
    });
    tx.movie.create.mockResolvedValue({ id: 'movie-id' });
    tx.season.upsert.mockResolvedValue({ id: 'season-2' });
    tx.episode.findFirst.mockResolvedValue(null);
  });

  it('creates the project movie from the project on the first episode, without a request body', async () => {
    givenProject();
    await service.createFromPackage('package-id', {}, 'reviewer-id');

    expect(dataOf(tx.movie.create)).toMatchObject({ title: 'Saigon 2077', synopsis: 'Phim AI', defaultLanguage: 'vi' });
    expect(tx.productionProject.update).toHaveBeenCalledWith({
      where: { id: 'project-id' },
      data: { movieId: 'movie-id' },
    });
    expect(dataOf(tx.episode.create)).toMatchObject({
      movieId: 'movie-id',
      seasonId: 'season-2',
      episodeNumber: 3,
      currentPackageId: 'package-id',
    });
  });

  it('adds later episodes to the same movie', async () => {
    givenProject({ movieId: 'movie-id' });
    await service.createFromPackage('package-id', {}, 'reviewer-id');

    expect(tx.movie.create).not.toHaveBeenCalled();
    expect(tx.movieGenre.createMany).not.toHaveBeenCalled();
    expect(dataOf(tx.episode.create)).toMatchObject({ movieId: 'movie-id' });
  });

  it('points an existing episode at a re-assembled package instead of duplicating it', async () => {
    givenProject({ movieId: 'movie-id' });
    tx.episode.findFirst.mockResolvedValue({ id: 'episode-id' });
    await service.createFromPackage('package-id', {}, 'reviewer-id');

    expect(tx.episode.create).not.toHaveBeenCalled();
    expect(tx.episode.update).toHaveBeenCalledWith({
      where: { id: 'episode-id' },
      data: { currentPackageId: 'package-id' },
    });
  });

  it('publishes a movie without a season', async () => {
    givenProject({ contentType: ProductionContentType.MOVIE });
    await service.createFromPackage('package-id', {}, 'reviewer-id');

    expect(tx.season.upsert).not.toHaveBeenCalled();
    expect(dataOf(tx.episode.create)).toMatchObject({ seasonId: null });
  });
});
