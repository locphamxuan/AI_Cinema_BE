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

  it('rejects a validity window that can never match an ad (P4-6)', async () => {
    const validFrom = new Date('2026-12-31T00:00:00.000Z');
    const validTo = new Date('2026-10-01T00:00:00.000Z');

    await expect(service.create({ ...dto, validFrom, validTo })).rejects.toMatchObject({
      response: expect.objectContaining({
        details: expect.objectContaining({ reason: 'AD_VALIDITY_WINDOW_INVALID' }),
      }),
    });
    // The scheduler tests validFrom <= now < validTo, so an equal pair is empty as well.
    await expect(service.create({ ...dto, validFrom, validTo: validFrom })).rejects.toMatchObject({
      response: expect.objectContaining({
        details: expect.objectContaining({ reason: 'AD_VALIDITY_WINDOW_INVALID' }),
      }),
    });
    expect(prisma.ad.create).not.toHaveBeenCalled();
  });

  it('keeps one-sided validity windows open', async () => {
    prisma.ad.create.mockResolvedValue({ id: 'ad-1', clickUrl: null, weight: 1, status: AdStatus.ACTIVE, ...dto });
    const validFrom = new Date('2026-10-01T00:00:00.000Z');

    await expect(service.create({ ...dto, validFrom })).resolves.toMatchObject({ id: 'ad-1' });
    expect(prisma.ad.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ validFrom, validTo: null }),
      }),
    );
  });

  it('validates the merged window when a PATCH moves one end (P4-6)', async () => {
    prisma.ad.findUnique.mockResolvedValue({
      id: 'ad-1',
      validFrom: new Date('2026-10-01T00:00:00.000Z'),
      validTo: null,
    });

    await expect(service.update('ad-1', { validTo: new Date('2026-09-01T00:00:00.000Z') })).rejects.toMatchObject({
      response: expect.objectContaining({
        details: expect.objectContaining({ reason: 'AD_VALIDITY_WINDOW_INVALID' }),
      }),
    });
    expect(prisma.ad.update).not.toHaveBeenCalled();

    prisma.ad.update.mockResolvedValue({ id: 'ad-1', status: AdStatus.ACTIVE });
    const validTo = new Date('2026-12-31T00:00:00.000Z');
    await expect(service.update('ad-1', { validTo })).resolves.toMatchObject({ id: 'ad-1' });
    expect(prisma.ad.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ validTo }) }),
    );
  });
});
