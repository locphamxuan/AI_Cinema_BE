import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MilestoneStatus, ProductionProjectStatus, UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { MilestoneService } from './milestone.service';

describe('MilestoneService', () => {
  const prisma = {
    productionProject: { findUnique: jest.fn() },
    milestone: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  };
  const service = new MilestoneService(prisma as unknown as PrismaService);

  const givenMilestone = (overrides: object = {}) =>
    prisma.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      status: MilestoneStatus.PLANNED,
      resultText: null,
      ...overrides,
    });
  const updatedData = () => (prisma.milestone.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

  beforeEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('adds a milestone to an open project', async () => {
      prisma.productionProject.findUnique.mockResolvedValue({ id: 'p1', status: ProductionProjectStatus.ACTIVE });
      await service.create('p1', { title: 'Kịch bản', targetDate: '2026-10-30T00:00:00.000Z' });

      expect(prisma.milestone.create).toHaveBeenCalledWith({
        data: {
          productionProjectId: 'p1',
          title: 'Kịch bản',
          description: undefined,
          targetDate: new Date('2026-10-30T00:00:00.000Z'),
        },
      });
    });

    it.each([ProductionProjectStatus.CANCELLED, ProductionProjectStatus.COMPLETED])(
      'refuses a %s project',
      async (status) => {
        prisma.productionProject.findUnique.mockResolvedValue({ id: 'p1', status });
        await expect(service.create('p1', { title: 'x' })).rejects.toThrow(ConflictException);
      },
    );

    it('reports a missing project', async () => {
      prisma.productionProject.findUnique.mockResolvedValue(null);
      await expect(service.create('p1', { title: 'x' })).rejects.toThrow(NotFoundException);
      await expect(service.findAll('p1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('lets the Creator report progress', async () => {
      givenMilestone();
      await service.update('m1', { status: MilestoneStatus.IN_PROGRESS }, UserRole.CONTENT_CREATOR);
      expect(updatedData()).toEqual({ status: MilestoneStatus.IN_PROGRESS });
    });

    it("keeps the plan of a milestone the Reviewer's", async () => {
      givenMilestone();
      await expect(
        service.update('m1', { targetDate: '2026-12-01T00:00:00.000Z' }, UserRole.CONTENT_CREATOR),
      ).rejects.toThrow(ForbiddenException);

      await service.update('m1', { title: 'Mới', targetDate: '2026-12-01T00:00:00.000Z' }, UserRole.CONTENT_REVIEWER);
      expect(updatedData()).toMatchObject({ title: 'Mới', targetDate: new Date('2026-12-01T00:00:00.000Z') });
    });

    it('completes a milestone only with a result, stamping when', async () => {
      givenMilestone({ status: MilestoneStatus.IN_PROGRESS });
      await expect(
        service.update('m1', { status: MilestoneStatus.COMPLETED, resultText: '  ' }, UserRole.CONTENT_CREATOR),
      ).rejects.toThrow(BadRequestException);

      await service.update(
        'm1',
        { status: MilestoneStatus.COMPLETED, resultText: 'Xong 5 tập' },
        UserRole.CONTENT_CREATOR,
      );
      expect(updatedData()).toMatchObject({ status: MilestoneStatus.COMPLETED, resultText: 'Xong 5 tập' });
      expect(updatedData().completedAt).toBeInstanceOf(Date);
    });

    it('never reopens a completed milestone', async () => {
      givenMilestone({ status: MilestoneStatus.COMPLETED, resultText: 'Xong' });
      await expect(
        service.update('m1', { status: MilestoneStatus.IN_PROGRESS }, UserRole.CONTENT_REVIEWER),
      ).rejects.toThrow('Cannot reopen');
    });

    it('does not restamp a milestone that was already completed', async () => {
      givenMilestone({ status: MilestoneStatus.COMPLETED, resultText: 'Xong' });
      await service.update('m1', { resultText: 'Xong, có ghi chú' }, UserRole.CONTENT_CREATOR);
      expect(updatedData()).toEqual({ resultText: 'Xong, có ghi chú', status: MilestoneStatus.COMPLETED });
    });

    it('reports a missing milestone', async () => {
      prisma.milestone.findUnique.mockResolvedValue(null);
      await expect(service.update('m1', {}, UserRole.CONTENT_REVIEWER)).rejects.toThrow(NotFoundException);
    });
  });
});
