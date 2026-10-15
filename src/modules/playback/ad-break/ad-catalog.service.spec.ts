import { AdStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AdCatalogService } from './ad-catalog.service';

describe('AdCatalogService', () => {
  const prisma = { ad: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
  const service = new AdCatalogService(prisma as unknown as PrismaService);

  const dto = { title: 'Ad', mediaUrl: 'https://cdn.example/a.mp4', durationSeconds: 15 };

  beforeEach(() => jest.clearAllMocks());

  it('creates an active ad with default weight', async () => {
    prisma.ad.create.mockResolvedValue({ id: 'ad-1', clickUrl: null, weight: 1, status: AdStatus.ACTIVE, ...dto });
    await expect(service.create(dto)).resolves.toMatchObject({ id: 'ad-1', weight: 1, status: 'ACTIVE' });
    expect(prisma.ad.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining(dto) }));
  });

  it('pauses an ad and answers 404 for a missing one', async () => {
    prisma.ad.findUnique.mockResolvedValue({ id: 'ad-1' });
    prisma.ad.update.mockResolvedValue({ id: 'ad-1', status: AdStatus.PAUSED });
    await expect(service.update('ad-1', { status: AdStatus.PAUSED })).resolves.toMatchObject({ status: 'PAUSED' });

    prisma.ad.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', {})).rejects.toThrow(NotFoundException);
  });
});
