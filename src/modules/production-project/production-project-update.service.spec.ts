import { ConflictException } from '@nestjs/common';
import { GenerationJobStatus, ProductionProjectStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductionProjectService } from './production-project.service';
import type { PlatformSettingService } from 'src/modules/platform-setting/platform-setting.service';

const assertEpisodeDurationAllowed = jest.fn().mockResolvedValue(undefined);
const platformSetting = { assertEpisodeDurationAllowed } as unknown as PlatformSettingService;

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
  const service = new ProductionProjectService(prisma as unknown as PrismaService, platformSetting);
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
