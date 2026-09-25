import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { GenerationJobStatus, ProductionContentType, ProductionProjectStatus, UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';
import { ProductionProjectService } from './production-project.service';

describe('ProductionProjectService.create — seasons and episode durations', () => {
  const tx = {
    productionProject: { create: jest.fn() },
    productionProjectGenre: { createMany: jest.fn() },
    projectPolicy: { createMany: jest.fn() },
    milestone: { createMany: jest.fn() },
    productionPlan: { createMany: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    productionProject: { findFirst: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new ProductionProjectService(prisma as unknown as PrismaService);

  const baseDto = (overrides: Partial<CreateProductionProjectRequestDto>): CreateProductionProjectRequestDto => ({
    title: 'Saigon 2077',
    contentType: ProductionContentType.SERIES,
    productionStartDate: '2026-10-01T00:00:00.000Z',
    deadline: '2026-12-01T00:00:00.000Z',
    plannedReleaseDate: '2027-01-01T00:00:00.000Z',
    totalAiQuotaBudget: 1000,
    assignedCreatorId: 'creator-id',
    ...overrides,
  });
  const createdPlans = () =>
    (tx.productionPlan.createMany.mock.calls[0] as [{ data: Record<string, unknown>[] }])[0].data;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'creator-id', role: UserRole.CONTENT_CREATOR });
    prisma.productionProject.findFirst.mockResolvedValue(null);
    tx.productionProject.create.mockResolvedValue({ id: 'project-id', assignedCreatorId: 'creator-id' });
  });

  it('creates one plan per episode, numbering episodes inside each season', async () => {
    await service.create(
      baseDto({
        episodes: [
          { seasonNumber: 1, targetDurationSeconds: 1200 },
          { seasonNumber: 2, targetDurationSeconds: 1500 },
          { seasonNumber: 1, targetDurationSeconds: 900 },
        ],
      }),
      'reviewer-id',
    );

    expect(
      createdPlans().map((p) => [p.episodeNumber, p.seasonNumber, p.seasonEpisodeNumber, p.allottedDurationSeconds]),
    ).toEqual([
      [1, 1, 1, 1200],
      [2, 1, 2, 900],
      [3, 2, 1, 1500],
    ]);
    expect((tx.productionProject.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data).toMatchObject({
      episodeCount: 3,
      defaultEpisodeDurationSeconds: 1500,
      subtitleLanguages: ['vi'],
    });
    expect(createdPlans().every((p) => (p.targetLanguages as string[]).join() === 'vi')).toBe(true);
  });

  it('subtitles every plan in the languages chosen for the project', async () => {
    await service.create(baseDto({ episodeCount: 2, subtitleLanguages: ['vi', 'en', 'vi'] }), 'reviewer-id');

    expect(createdPlans().map((p) => p.targetLanguages)).toEqual([
      ['vi', 'en'],
      ['vi', 'en'],
    ]);
  });

  it('keeps the single-season behaviour when only episodeCount is sent', async () => {
    await service.create(baseDto({ episodeCount: 2, defaultEpisodeDurationSeconds: 1800 }), 'reviewer-id');
    expect(createdPlans().map((p) => [p.seasonNumber, p.seasonEpisodeNumber, p.allottedDurationSeconds])).toEqual([
      [1, 1, 1800],
      [1, 2, 1800],
    ]);
  });

  it.each([
    [
      'a gap between seasons',
      {
        episodes: [
          { seasonNumber: 1, targetDurationSeconds: 60 },
          { seasonNumber: 3, targetDurationSeconds: 60 },
        ],
      },
    ],
    ['an episodeCount that disagrees', { episodeCount: 5, episodes: [{ seasonNumber: 1, targetDurationSeconds: 60 }] }],
    [
      'an episode longer than the cap',
      {
        episodeCount: undefined,
        defaultEpisodeDurationSeconds: 60,
        episodes: [{ seasonNumber: 1, targetDurationSeconds: 61 }],
      },
    ],
    [
      'several seasons for a movie',
      {
        contentType: ProductionContentType.MOVIE,
        episodeCount: undefined,
        episodes: [
          { seasonNumber: 1, targetDurationSeconds: 60 },
          { seasonNumber: 2, targetDurationSeconds: 60 },
        ],
      },
    ],
  ])('rejects %s', async (_case, overrides) => {
    await expect(
      service.create(baseDto(overrides as Partial<CreateProductionProjectRequestDto>), 'reviewer-id'),
    ).rejects.toThrow(BadRequestException);
    expect(tx.productionProject.create).not.toHaveBeenCalled();
  });
});

describe('ProductionProjectService.create — validation', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    productionProject: { findFirst: jest.fn() },
    genre: { count: jest.fn() },
    policy: { count: jest.fn() },
  };
  const service = new ProductionProjectService(prisma as unknown as PrismaService);
  const dto = (overrides: Partial<CreateProductionProjectRequestDto> = {}): CreateProductionProjectRequestDto => ({
    title: 'Saigon 2077',
    contentType: ProductionContentType.SERIES,
    episodeCount: 3,
    productionStartDate: '2026-10-01T00:00:00.000Z',
    deadline: '2026-12-01T00:00:00.000Z',
    plannedReleaseDate: '2027-01-01T00:00:00.000Z',
    totalAiQuotaBudget: 1000,
    assignedCreatorId: 'creator-id',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'creator-id', role: UserRole.CONTENT_CREATOR });
    prisma.productionProject.findFirst.mockResolvedValue(null);
  });

  it('assigns the project only to a Creator', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'creator-id', role: UserRole.CONTENT_REVIEWER });
    await expect(service.create(dto(), 'reviewer-id')).rejects.toThrow(ForbiddenException);

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.create(dto(), 'reviewer-id')).rejects.toThrow(BadRequestException);
  });

  it.each([
    ['release before the deadline', { plannedReleaseDate: '2026-11-01T00:00:00.000Z' }, 'plannedReleaseDate'],
    [
      'production starting after the deadline',
      { productionStartDate: '2027-01-01T00:00:00.000Z' },
      'productionStartDate',
    ],
    ['a series without an episode count', { episodeCount: undefined }, 'episodeCount is required'],
    [
      'seasons with a gap',
      { episodeCount: undefined, episodes: [{ seasonNumber: 2, targetDurationSeconds: 60 }] },
      'without gaps',
    ],
    [
      'a movie with two seasons',
      {
        contentType: ProductionContentType.MOVIE,
        episodeCount: undefined,
        episodes: [
          { seasonNumber: 1, targetDurationSeconds: 60 },
          { seasonNumber: 2, targetDurationSeconds: 60 },
        ],
      },
      'single season',
    ],
    [
      'an episode count that disagrees with the episodes',
      { episodeCount: 2, episodes: [{ seasonNumber: 1, targetDurationSeconds: 60 }] },
      'does not match',
    ],
    [
      'an episode longer than the default duration',
      {
        episodeCount: undefined,
        defaultEpisodeDurationSeconds: 60,
        episodes: [{ seasonNumber: 1, targetDurationSeconds: 90 }],
      },
      'may exceed',
    ],
    [
      'a milestone ending before it starts',
      { milestones: [{ title: 'M1', startDate: '2026-11-01T00:00:00.000Z', targetDate: '2026-10-15T00:00:00.000Z' }] },
      'startDate must be on or before',
    ],
  ])('refuses %s', async (_case, overrides, message) => {
    await expect(service.create(dto(overrides), 'reviewer-id')).rejects.toThrow(message);
  });

  it('refuses a duplicate title and unknown genres', async () => {
    prisma.productionProject.findFirst.mockResolvedValueOnce({ id: 'other' });
    await expect(service.create(dto(), 'reviewer-id')).rejects.toThrow(ConflictException);

    prisma.genre.count.mockResolvedValue(1);
    await expect(service.create(dto({ genreIds: ['g1', 'g2'] }), 'reviewer-id')).rejects.toThrow('genreIds');
  });
});

describe('ProductionProjectService.update and cancel', () => {
  const tx = {
    productionProject: { update: jest.fn(), findUnique: jest.fn() },
    productionProjectGenre: { deleteMany: jest.fn(), createMany: jest.fn() },
    projectPolicy: { deleteMany: jest.fn(), createMany: jest.fn() },
    generationJob: { updateMany: jest.fn() },
  };
  const prisma = {
    productionProject: { findUnique: jest.fn(), findFirst: jest.fn() },
    productionPlan: { findMany: jest.fn() },
    quotaAllocation: { aggregate: jest.fn() },
    generationJob: { findFirst: jest.fn() },
    genre: { count: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new ProductionProjectService(prisma as unknown as PrismaService);
  const updatedData = () => (tx.productionProject.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

  const givenProject = (overrides: object = {}) =>
    prisma.productionProject.findUnique.mockResolvedValue({
      id: 'project-id',
      status: ProductionProjectStatus.ACTIVE,
      totalAiQuotaBudget: '1000',
      remainingAiQuotaBudget: '400',
      deadline: new Date('2026-12-01T00:00:00.000Z'),
      plannedReleaseDate: new Date('2027-01-01T00:00:00.000Z'),
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    givenProject();
    prisma.productionProject.findFirst.mockResolvedValue(null);
    prisma.quotaAllocation.aggregate.mockResolvedValue({ _sum: { allocatedAmount: 600 } });
    prisma.productionPlan.findMany.mockResolvedValue([]);
  });

  it('moves the remaining budget by the change instead of overwriting it', async () => {
    await service.update('project-id', { totalAiQuotaBudget: 1500 });
    expect(updatedData()).toMatchObject({ totalAiQuotaBudget: 1500, remainingAiQuotaBudget: { increment: 500 } });
  });

  it('never lowers the budget below what was already granted', async () => {
    await expect(service.update('project-id', { totalAiQuotaBudget: 500 })).rejects.toThrow('already allocated');
  });

  it('keeps the release on or after the deadline', async () => {
    await expect(service.update('project-id', { deadline: '2027-02-01T00:00:00.000Z' })).rejects.toThrow(
      'plannedReleaseDate',
    );
  });

  it('keeps episodes long enough for the scenes already planned', async () => {
    prisma.productionPlan.findMany.mockResolvedValue([
      { scenes: [{ targetDurationSeconds: 400 }, { targetDurationSeconds: 300 }] },
    ]);
    await expect(service.update('project-id', { defaultEpisodeDurationSeconds: 600 })).rejects.toThrow('700s');
  });

  it('replaces the genres', async () => {
    prisma.genre.count.mockResolvedValue(1);
    await service.update('project-id', { genreIds: ['g1', 'g1'] });
    expect(tx.productionProjectGenre.deleteMany).toHaveBeenCalledWith({ where: { productionProjectId: 'project-id' } });
    expect(tx.productionProjectGenre.createMany).toHaveBeenCalledWith({
      data: [{ productionProjectId: 'project-id', genreId: 'g1' }],
    });
  });

  it('changes nothing on a finished project', async () => {
    givenProject({ status: ProductionProjectStatus.COMPLETED });
    await expect(service.update('project-id', { title: 'x' })).rejects.toThrow(ConflictException);
    await expect(service.cancel('project-id', { reason: 'x' })).rejects.toThrow(ConflictException);
  });

  it('cancels a project, dropping its queued jobs, but not while one is running', async () => {
    prisma.productionPlan.findMany.mockResolvedValue([{ id: 'plan-1' }]);
    prisma.generationJob.findFirst.mockResolvedValueOnce({ id: 'running' });
    await expect(service.cancel('project-id', { reason: 'Hết ngân sách' })).rejects.toThrow('is running');

    prisma.generationJob.findFirst.mockResolvedValue(null);
    await service.cancel('project-id', { reason: 'Hết ngân sách' });
    expect(tx.generationJob.updateMany).toHaveBeenCalledWith({
      where: {
        productionPlanId: { in: ['plan-1'] },
        status: { in: [GenerationJobStatus.PENDING, GenerationJobStatus.QUEUED] },
      },
      data: { status: 'CANCELLED' },
    });
    expect(updatedData()).toEqual({ status: ProductionProjectStatus.CANCELLED, cancelledReason: 'Hết ngân sách' });
  });
});
