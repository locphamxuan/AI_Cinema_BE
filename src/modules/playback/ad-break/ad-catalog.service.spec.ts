import { AdStatus } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { MediaProcessor } from 'src/modules/production/media-ingest/pipeline/media-processor';
import { AdCatalogService } from './ad-catalog.service';
import { MAX_AD_DURATION_SECONDS } from './ad-limits';

describe('AdCatalogService', () => {
  const prisma = { ad: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
  const processor = { probe: jest.fn() };
  const config = { media: { allowPrivateUrls: true } } as AppConfig;
  const service = new AdCatalogService(
    prisma as unknown as PrismaService,
    processor as unknown as MediaProcessor,
    config,
  );

  const dto = { title: 'Ad', mediaUrl: 'https://cdn.example/a.mp4' };
  const row = { id: 'ad-1', ...dto, clickUrl: null, durationSeconds: 15, weight: 1, status: AdStatus.ACTIVE };

  beforeEach(() => {
    jest.clearAllMocks();
    processor.probe.mockResolvedValue({ durationSeconds: 15, height: 720, hasAudio: true });
    prisma.ad.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...row, ...data }));
    prisma.ad.update.mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...row, ...data }));
  });

  it('creates an active ad whose length is read from the video', async () => {
    await expect(service.create(dto)).resolves.toMatchObject({ id: 'ad-1', durationSeconds: 15, weight: 1 });
    expect(processor.probe).toHaveBeenCalledWith(dto.mediaUrl);
    expect(prisma.ad.create).toHaveBeenCalledWith({ data: expect.objectContaining({ durationSeconds: 15 }) });
  });

  it('refuses a video it cannot read or one too long to be a mid-roll', async () => {
    processor.probe.mockRejectedValueOnce(new Error('ffprobe exited with 1'));
    await expect(service.create(dto)).rejects.toMatchObject({
      response: expect.objectContaining({ details: { reason: 'AD_VIDEO_UNREADABLE' } }),
    });

    processor.probe.mockResolvedValueOnce({
      durationSeconds: MAX_AD_DURATION_SECONDS + 1,
      height: 720,
      hasAudio: true,
    });
    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    expect(prisma.ad.create).not.toHaveBeenCalled();
  });

  it('reads the length again only when the video changes', async () => {
    prisma.ad.findUnique.mockResolvedValue(row);
    await service.update('ad-1', { mediaUrl: dto.mediaUrl, status: AdStatus.PAUSED });
    expect(processor.probe).not.toHaveBeenCalled();

    processor.probe.mockResolvedValueOnce({ durationSeconds: 42, height: 720, hasAudio: true });
    await expect(service.update('ad-1', { mediaUrl: 'https://cdn.example/b.mp4' })).resolves.toMatchObject({
      durationSeconds: 42,
    });
  });

  it('answers 404 for a missing ad', async () => {
    prisma.ad.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', {})).rejects.toThrow(NotFoundException);
  });
});
