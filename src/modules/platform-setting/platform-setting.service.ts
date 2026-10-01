import { BadRequestException, Injectable } from '@nestjs/common';
import type { PlatformSetting } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdatePlatformSettingRequestDto } from './dto/update-platform-setting.request.dto';

const SETTING_ID = 'default';

/** Platform policies only the Admin configures (one row; the column defaults are the initial values). */
@Injectable()
export class PlatformSettingService {
  constructor(private readonly prisma: PrismaService) {}

  /** The settings row, created with its defaults the first time it is read. */
  get(): Promise<PlatformSetting> {
    return this.prisma.platformSetting.upsert({ where: { id: SETTING_ID }, create: { id: SETTING_ID }, update: {} });
  }

  async update(dto: UpdatePlatformSettingRequestDto, updatedById: string): Promise<PlatformSetting> {
    const current = await this.get();
    const min = dto.episodeCoinPriceMin ?? current.episodeCoinPriceMin;
    const max = dto.episodeCoinPriceMax ?? current.episodeCoinPriceMax;
    if (min > max) {
      throw new BadRequestException(`The lowest episode price (${min}) cannot exceed the highest (${max})`);
    }
    return this.prisma.platformSetting.update({ where: { id: SETTING_ID }, data: { ...dto, updatedById } });
  }
}
