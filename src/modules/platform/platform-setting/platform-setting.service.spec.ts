import { BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService, SETTINGS_CACHE_TTL_MS } from './platform-setting.service';

describe('PlatformSettingService', () => {
  const stored = { id: 'default', episodeCoinPriceMin: 1, episodeCoinPriceMax: 50 };
  const prisma = { platformSetting: { upsert: jest.fn(), update: jest.fn() } };
  let service: PlatformSettingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PlatformSettingService(prisma as unknown as PrismaService);
    prisma.platformSetting.upsert.mockResolvedValue(stored);
  });

  it('creates the row with its defaults the first time the settings are read', async () => {
    await expect(service.get()).resolves.toBe(stored);
    expect(prisma.platformSetting.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
  });

  it('records who changed the settings', async () => {
    await service.update({ episodeCoinPriceMax: 80 }, 'admin-id');
    expect(prisma.platformSetting.update).toHaveBeenCalledWith({
      where: { id: 'default' },
      data: { episodeCoinPriceMax: 80, updatedById: 'admin-id' },
    });
  });

  it('rejects a price range whose lowest price is above the highest one', async () => {
    await expect(service.update({ episodeCoinPriceMin: 60 }, 'admin-id')).rejects.toThrow(BadRequestException);
    expect(prisma.platformSetting.update).not.toHaveBeenCalled();
  });

  it('serves hot reads from cache instead of hitting the row again', async () => {
    await service.get();
    await service.get();
    await service.get();
    expect(prisma.platformSetting.upsert).toHaveBeenCalledTimes(1);
  });

  it('refreshes after the TTL and shares one flight for concurrent reads', async () => {
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000_000);
      await service.get();
      now.mockReturnValue(1_000_000 + SETTINGS_CACHE_TTL_MS);
      await Promise.all([service.get(), service.get(), service.get()]);
      expect(prisma.platformSetting.upsert).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it('an update is visible immediately without waiting for the TTL', async () => {
    const updated = { ...stored, episodeCoinPriceMax: 80 };
    prisma.platformSetting.update.mockResolvedValue(updated);
    await service.get();
    await service.update({ episodeCoinPriceMax: 80 }, 'admin-id');
    await expect(service.get()).resolves.toBe(updated);
    expect(prisma.platformSetting.upsert).toHaveBeenCalledTimes(1);
  });
});
