import { BadRequestException } from '@nestjs/common';
import { ProductionContentType, UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';
import { ProductionProjectService } from './production-project.service';

describe('ProductionProjectService.create — seasons and episode durations', () => {
  const tx = {
    productionProject: { create: jest.fn(), findUnique: jest.fn() },
    productionProjectGenre: { createMany: jest.fn() },
    projectPolicy: { createMany: jest.fn() },
    milestone: { createMany: jest.fn() },
    productionPlan: { create: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    productionProject: { findFirst: jest.fn() },
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
    tx.productionPlan.create.mock.calls.map(([{ data }]: [{ data: Record<string, unknown> }]) => data);

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
    });
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
      { defaultEpisodeDurationSeconds: 60, episodes: [{ seasonNumber: 1, targetDurationSeconds: 61 }] },
    ],
    [
      'several seasons for a movie',
      {
        contentType: ProductionContentType.MOVIE,
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
