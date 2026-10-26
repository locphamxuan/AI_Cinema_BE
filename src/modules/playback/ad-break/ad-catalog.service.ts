import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Ad } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { assertPublicUrl, UnsafeUrlError } from 'src/common/security/safe-url';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { MediaProcessor } from 'src/modules/production/media-ingest/pipeline/media-processor';
import { AdViewDto } from 'src/modules/playback/ad-break/dto/ad.view.dto';
import { CreateAdRequestDto } from 'src/modules/playback/ad-break/dto/create-ad.request.dto';
import { UpdateAdRequestDto } from 'src/modules/playback/ad-break/dto/update-ad.request.dto';
import { MAX_AD_DURATION_SECONDS } from './ad-limits';

/**
 * Minimal ad catalog: list, create, pause/resume. The Admin never types a length: it is read from the
 * video itself, because the viewer has to watch the whole ad before the episode goes on (BR-33).
 */
@Injectable()
export class AdCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: MediaProcessor,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  ads(query: PaginateQuery) {
    return paginate(query, this.prisma.ad, {
      sortableColumns: ['createdAt', 'weight', 'status'],
      defaultSortBy: [['createdAt', 'DESC']],
    });
  }

  async create(dto: CreateAdRequestDto): Promise<AdViewDto> {
    const durationSeconds = await this.lengthOf(dto.mediaUrl);
    const ad = await this.prisma.ad.create({
      data: {
        title: dto.title,
        mediaUrl: dto.mediaUrl,
        clickUrl: dto.clickUrl ?? null,
        durationSeconds,
        weight: dto.weight ?? 1,
      },
    });
    return view(ad);
  }

  async update(id: string, dto: UpdateAdRequestDto): Promise<AdViewDto> {
    const existing = await this.prisma.ad.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Ad not found', details: { reason: 'AD_NOT_FOUND' } });
    }
    const newVideo = dto.mediaUrl !== undefined && dto.mediaUrl !== existing.mediaUrl;
    const ad = await this.prisma.ad.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(newVideo ? { mediaUrl: dto.mediaUrl, durationSeconds: await this.lengthOf(dto.mediaUrl!) } : {}),
        ...(dto.clickUrl !== undefined ? { clickUrl: dto.clickUrl } : {}),
        ...(dto.weight !== undefined ? { weight: dto.weight } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    return view(ad);
  }

  /** Seconds the video runs, read with ffprobe; refuses a link that is unsafe, unreadable or too long to be a mid-roll. */
  private async lengthOf(mediaUrl: string): Promise<number> {
    await assertPublicUrl(mediaUrl, { allowPrivate: this.config.media.allowPrivateUrls }).catch((error) => {
      throw error instanceof UnsafeUrlError ? new BadRequestException(error.message) : error;
    });
    const { durationSeconds } = await this.processor.probe(mediaUrl).catch(() => {
      throw new BadRequestException({
        message: 'The ad video cannot be read; give a direct link to an MP4 file',
        details: { reason: 'AD_VIDEO_UNREADABLE' },
      });
    });
    if (durationSeconds > MAX_AD_DURATION_SECONDS) {
      throw new BadRequestException({
        message: `An ad runs at most ${MAX_AD_DURATION_SECONDS} seconds`,
        details: { reason: 'AD_TOO_LONG', durationSeconds, maxSeconds: MAX_AD_DURATION_SECONDS },
      });
    }
    return Math.max(1, durationSeconds);
  }
}

function view(ad: Ad): AdViewDto {
  return {
    id: ad.id,
    title: ad.title,
    mediaUrl: ad.mediaUrl,
    clickUrl: ad.clickUrl,
    durationSeconds: ad.durationSeconds,
    weight: ad.weight,
    status: ad.status,
  };
}
