import { Injectable, NotFoundException } from '@nestjs/common';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AdViewDto, CreateAdRequestDto, UpdateAdRequestDto } from './dto/ad.dto';

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
    const ad = await this.prisma.ad.create({
      data: {
        title: dto.title,
        mediaUrl: dto.mediaUrl,
        clickUrl: dto.clickUrl ?? null,
        durationSeconds: dto.durationSeconds,
        weight: dto.weight ?? 1,
        validFrom: dto.validFrom ?? null,
        validTo: dto.validTo ?? null,
      },
    });
    return view(ad);
  }

  async update(id: string, dto: UpdateAdRequestDto): Promise<AdViewDto> {
    const existing = await this.prisma.ad.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Ad not found', details: { reason: 'AD_NOT_FOUND' } });
    }
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

function view(ad: {
  id: string;
  title: string;
  mediaUrl: string;
  clickUrl: string | null;
  durationSeconds: number;
  weight: number;
  status: 'ACTIVE' | 'PAUSED';
}): AdViewDto {
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
