import { BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PlatformSettingService } from './platform-setting.service';

describe('PlatformSettingService', () => {
  const stored = { id: 'default', episodeCoinPriceMin: 1, episodeCoinPriceMax: 50 };
  const prisma = { platformSetting: { upsert: jest.fn(), update: jest.fn() } };
  const service = new PlatformSettingService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
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
});
