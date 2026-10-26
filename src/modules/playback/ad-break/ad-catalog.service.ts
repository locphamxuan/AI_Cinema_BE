import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AdViewDto } from 'src/modules/playback/ad-break/dto/ad.view.dto';
import { CreateAdRequestDto } from 'src/modules/playback/ad-break/dto/create-ad.request.dto';
import { UpdateAdRequestDto } from 'src/modules/playback/ad-break/dto/update-ad.request.dto';

/** Minimal ad catalog: list, create, pause/resume. No campaigns or targeting in this phase. */
@Injectable()
export class AdCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  ads(query: PaginateQuery) {
    return paginate(query, this.prisma.ad, {
      sortableColumns: ['createdAt', 'weight', 'status'],
      defaultSortBy: [['createdAt', 'DESC']],
    });
  }

  async create(dto: CreateAdRequestDto): Promise<AdViewDto> {
    const validFrom = dto.validFrom ?? null;
    const validTo = dto.validTo ?? null;
    assertValidityWindow(validFrom, validTo);
    const ad = await this.prisma.ad.create({
      data: {
        title: dto.title,
        mediaUrl: dto.mediaUrl,
        clickUrl: dto.clickUrl ?? null,
        durationSeconds: dto.durationSeconds,
        weight: dto.weight ?? 1,
        validFrom,
        validTo,
      },
    });
    return view(ad);
  }

  async update(id: string, dto: UpdateAdRequestDto): Promise<AdViewDto> {
    const existing = await this.prisma.ad.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Ad not found', details: { reason: 'AD_NOT_FOUND' } });
    }
    // P4-6: a PATCH may move one end of the window, so the merged row must still be valid.
    assertValidityWindow(
      dto.validFrom !== undefined ? dto.validFrom : existing.validFrom,
      dto.validTo !== undefined ? dto.validTo : existing.validTo,
    );
    const ad = await this.prisma.ad.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.mediaUrl !== undefined ? { mediaUrl: dto.mediaUrl } : {}),
        ...(dto.clickUrl !== undefined ? { clickUrl: dto.clickUrl } : {}),
        ...(dto.durationSeconds !== undefined ? { durationSeconds: dto.durationSeconds } : {}),
        ...(dto.weight !== undefined ? { weight: dto.weight } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.validFrom !== undefined ? { validFrom: dto.validFrom } : {}),
        ...(dto.validTo !== undefined ? { validTo: dto.validTo } : {}),
      },
    });
    return view(ad);
  }
}

/**
 * P4-6: reject a window that can never match an ad. An equal pair is empty too —
 * scheduleFor() looks for `validFrom <= now < validTo`. One-sided windows stay open.
 */
function assertValidityWindow(validFrom: Date | null, validTo: Date | null): void {
  if (validFrom && validTo && validFrom.getTime() >= validTo.getTime()) {
    throw new BadRequestException({
      message: 'validFrom must be earlier than validTo',
      details: { reason: 'AD_VALIDITY_WINDOW_INVALID', validFrom, validTo },
    });
  }
}

function view(ad: {
  id: string;
  title: string;
  mediaUrl: string;
  clickUrl: string | null;
  durationSeconds: number;
  weight: number;
  status: 'ACTIVE' | 'PAUSED';
  validFrom: Date | null;
  validTo: Date | null;
}): AdViewDto {
  return {
    id: ad.id,
    title: ad.title,
    mediaUrl: ad.mediaUrl,
    clickUrl: ad.clickUrl,
    durationSeconds: ad.durationSeconds,
    weight: ad.weight,
    status: ad.status,
    validFrom: ad.validFrom,
    validTo: ad.validTo,
  };
}
