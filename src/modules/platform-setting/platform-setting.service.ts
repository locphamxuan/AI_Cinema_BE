import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdatePlatformSettingRequestDto } from './dto/update-platform-setting.request.dto';

const SETTING_ID = 'default';
// Used until the Admin saves the settings once (the migration seeds the same value).
export const DEFAULT_MAX_EPISODE_DURATION_SECONDS = 3600;

@Injectable()
export class PlatformSettingService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const setting = await this.prisma.platformSetting.findUnique({ where: { id: SETTING_ID } });
    return (
      setting ?? {
        id: SETTING_ID,
        maxEpisodeDurationSeconds: DEFAULT_MAX_EPISODE_DURATION_SECONDS,
        updatedById: null,
        updatedAt: null,
      }
    );
  }

  async update(dto: UpdatePlatformSettingRequestDto, updatedById: string) {
    const data = { maxEpisodeDurationSeconds: dto.maxEpisodeDurationSeconds, updatedById };
    return this.prisma.platformSetting.upsert({
      where: { id: SETTING_ID },
      create: { id: SETTING_ID, ...data },
      update: data,
    });
  }

  /** Rejects durations (seconds) longer than the configured episode limit. */
  async assertEpisodeDurationAllowed(durations: (number | null | undefined)[], what = 'An episode') {
    const { maxEpisodeDurationSeconds: max } = await this.get();
    if (max === null) return;
    const longest = Math.max(0, ...durations.map((d) => d ?? 0));
    if (longest > max) {
      throw new BadRequestException(`${what} lasts ${longest}s, longer than the platform limit of ${max}s`);
    }
  }
}
