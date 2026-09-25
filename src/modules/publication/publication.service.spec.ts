import { BadRequestException, ConflictException } from '@nestjs/common';
import { ComplianceCheckType, ComplianceResult, EpisodeProductionStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { PublicationService } from './publication.service';

const passing = Object.values(ComplianceCheckType).map((checkType) => ({
  checkType,
  result: ComplianceResult.PASS,
  checkedAt: new Date(),
}));

describe('PublicationService', () => {
  const tx = {
    publication: { update: jest.fn() },
    episode: { update: jest.fn(), count: jest.fn() },
    productionProject: { findUnique: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    episode: { findUnique: jest.fn() },
    episodePackage: { findUnique: jest.fn() },
    publication: { create: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new PublicationService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.episode.findUnique.mockResolvedValue({ id: 'ep-id', currentPackageId: 'pkg-id' });
    tx.episode.update.mockResolvedValue({ id: 'ep-id', movieId: 'movie-id' });
    tx.productionProject.findUnique.mockResolvedValue({ id: 'project-id', status: 'ACTIVE', episodeCount: 2 });
  });

  it('creates a publication for the current, fully compliant package', async () => {
    prisma.episodePackage.findUnique.mockResolvedValue({ id: 'pkg-id', complianceChecks: passing });

    await service.create('ep-id', { packageId: 'pkg-id' }, 'reviewer-id');

    const [[args]] = prisma.publication.create.mock.calls as [[{ data: Record<string, unknown> }]];
    expect(args.data).toMatchObject({ episodePackageId: 'pkg-id', publishedById: 'reviewer-id' });
  });

  it('refuses a package that is not the current one or has not passed compliance (BR-42)', async () => {
    await expect(service.create('ep-id', { packageId: 'other' }, 'reviewer-id')).rejects.toThrow(BadRequestException);

    prisma.episodePackage.findUnique.mockResolvedValue({ id: 'pkg-id', complianceChecks: passing.slice(1) });
    await expect(service.create('ep-id', { packageId: 'pkg-id' }, 'reviewer-id')).rejects.toThrow(ConflictException);
  });

  it('publishing marks the episode PUBLISHED, and cannot happen twice', async () => {
    prisma.publication.findUnique.mockResolvedValue({ id: 'pub-id', episodeId: 'ep-id', publishedAt: null });

    await service.publish('pub-id');
    expect(tx.episode.update).toHaveBeenCalledWith({
      where: { id: 'ep-id' },
      data: { productionStatus: EpisodeProductionStatus.PUBLISHED },
    });

    prisma.publication.findUnique.mockResolvedValue({ id: 'pub-id', episodeId: 'ep-id', publishedAt: new Date() });
    await expect(service.publish('pub-id')).rejects.toThrow(ConflictException);
  });

  it('completes the project when its last episode goes live, and reopens it when one is pulled', async () => {
    prisma.publication.findUnique.mockResolvedValue({ id: 'pub-id', episodeId: 'ep-id', publishedAt: null });

    tx.episode.count.mockResolvedValue(1);
    await service.publish('pub-id');
    expect(tx.productionProject.update).not.toHaveBeenCalled();

    tx.episode.count.mockResolvedValue(2);
    await service.publish('pub-id');
    expect(tx.productionProject.update).toHaveBeenCalledWith({
      where: { id: 'project-id' },
      data: { status: 'COMPLETED' },
    });

    tx.productionProject.findUnique.mockResolvedValue({ id: 'project-id', status: 'COMPLETED', episodeCount: 2 });
    tx.episode.count.mockResolvedValue(1);
    await service.unpublish('pub-id');
    expect(tx.productionProject.update).toHaveBeenLastCalledWith({
      where: { id: 'project-id' },
      data: { status: 'ACTIVE' },
    });
  });
});
