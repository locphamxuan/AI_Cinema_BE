import { BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DEFAULT_MAX_EPISODE_DURATION_SECONDS, PlatformSettingService } from './platform-setting.service';

describe('PlatformSettingService', () => {
  const prisma = { platformSetting: { findUnique: jest.fn(), upsert: jest.fn() } };
  const service = new PlatformSettingService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('falls back to the default limit until the Admin saves the settings', async () => {
    prisma.platformSetting.findUnique.mockResolvedValue(null);
    expect((await service.get()).maxEpisodeDurationSeconds).toBe(DEFAULT_MAX_EPISODE_DURATION_SECONDS);
  });

  it('rejects an episode longer than the configured limit and accepts one at the limit', async () => {
    prisma.platformSetting.findUnique.mockResolvedValue({ id: 'default', maxEpisodeDurationSeconds: 2700 });

    await expect(service.assertEpisodeDurationAllowed([1800, 2700, undefined])).resolves.toBeUndefined();
    await expect(service.assertEpisodeDurationAllowed([1800, 3000])).rejects.toThrow(BadRequestException);
  });

  it('allows any duration when the Admin removed the limit', async () => {
    prisma.platformSetting.findUnique.mockResolvedValue({ id: 'default', maxEpisodeDurationSeconds: null });
    await expect(service.assertEpisodeDurationAllowed([6 * 3600])).resolves.toBeUndefined();
  });

  it('records who changed the settings', async () => {
    await service.update({ maxEpisodeDurationSeconds: null }, 'admin-id');
    expect(prisma.platformSetting.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      create: { id: 'default', maxEpisodeDurationSeconds: null, updatedById: 'admin-id' },
      update: { maxEpisodeDurationSeconds: null, updatedById: 'admin-id' },
    });
  });
});
