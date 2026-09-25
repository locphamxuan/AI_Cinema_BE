import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LabelType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiContentLabelService } from './ai-content-label.service';

describe('AiContentLabelService', () => {
  const prisma = {
    episodePackage: { findUnique: jest.fn() },
    policy: { findUnique: jest.fn() },
    aiContentLabel: { create: jest.fn(), findMany: jest.fn() },
  };
  const service = new AiContentLabelService(prisma as unknown as PrismaService);
  const dto = {
    labelType: LabelType.AI_GENERATED,
    labelText: 'Nội dung tạo bằng AI',
    displayLocation: 'FULL_DURATION',
    policyId: 'policy-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.episodePackage.findUnique.mockResolvedValue({ id: 'package-id' });
    prisma.policy.findUnique.mockResolvedValue({ id: 'policy-id' });
  });

  it('labels the package under the policy, recording who applied it (Điều 44)', async () => {
    await service.create('package-id', dto, 'reviewer-id');

    expect(prisma.aiContentLabel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { episodePackageId: 'package-id', ...dto, appliedById: 'reviewer-id' },
      }),
    );
  });

  it('refuses an unknown policy or package', async () => {
    prisma.policy.findUnique.mockResolvedValue(null);
    await expect(service.create('package-id', dto, 'reviewer-id')).rejects.toThrow(BadRequestException);

    prisma.episodePackage.findUnique.mockResolvedValue(null);
    await expect(service.create('package-id', dto, 'reviewer-id')).rejects.toThrow(NotFoundException);
    await expect(service.findAll('package-id')).rejects.toThrow(NotFoundException);
    expect(prisma.aiContentLabel.create).not.toHaveBeenCalled();
  });

  it('lists the labels of a package', async () => {
    await service.findAll('package-id');
    expect(prisma.aiContentLabel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { episodePackageId: 'package-id' } }),
    );
  });
});
