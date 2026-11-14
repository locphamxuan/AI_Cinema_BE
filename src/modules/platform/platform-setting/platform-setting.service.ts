import { BadRequestException, Injectable } from '@nestjs/common';
import type { PlatformSetting } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { UpdatePlatformSettingRequestDto } from './dto/update-platform-setting.request.dto';

const SETTING_ID = 'default';

/**
 * Hot-path shield: settings change rarely but are read on every session creation
 * and every heartbeat. Without this, each read is a write (upsert) on a single row.
 */
export const SETTINGS_CACHE_TTL_MS = 30_000;

/** Platform policies only the Admin configures (one row; the column defaults are the initial values). */
@Injectable()
export class PlatformSettingService {
  private cached: { at: number; row: PlatformSetting } | null = null;
  private inflight: Promise<PlatformSetting> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** The settings row, created with its defaults the first time it is read. Cached briefly. */
  get(): Promise<PlatformSetting> {
    const hit = this.cached;
    if (hit && Date.now() - hit.at < SETTINGS_CACHE_TTL_MS) return Promise.resolve(hit.row);
    if (this.inflight) return this.inflight;
    this.inflight = this.prisma.platformSetting
      .upsert({ where: { id: SETTING_ID }, create: { id: SETTING_ID }, update: {} })
      .then((row) => {
        this.cached = { at: Date.now(), row };
        return row;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  async update(dto: UpdatePlatformSettingRequestDto, updatedById: string): Promise<PlatformSetting> {
    const current = await this.get();
    const min = dto.episodeCoinPriceMin ?? current.episodeCoinPriceMin;
    const max = dto.episodeCoinPriceMax ?? current.episodeCoinPriceMax;
    if (min > max) {
      throw new BadRequestException(`The lowest episode price (${min}) cannot exceed the highest (${max})`);
    }
    const topUpMin = dto.coinTopUpMinVnd ?? current.coinTopUpMinVnd;
    const topUpMax = dto.coinTopUpMaxVnd ?? current.coinTopUpMaxVnd;
    if (topUpMin > topUpMax) {
      throw new BadRequestException(`The lowest top-up amount (${topUpMin}) cannot exceed the highest (${topUpMax})`);
    }
    const row = await this.prisma.platformSetting.update({ where: { id: SETTING_ID }, data: { ...dto, updatedById } });
    this.cached = { at: Date.now(), row };
    return row;
  }
}
