import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { EpisodeAdSlotsViewDto } from 'src/modules/playback/ad-break/dto/episode-ad-slots.view.dto';
import { SetEpisodeAdSlotsRequestDto } from 'src/modules/playback/ad-break/dto/set-episode-ad-slots.request.dto';

const SLOT_SELECT = {
  id: true,
  positionSeconds: true,
  ad: { select: { id: true, title: true } },
} as const;

/**
 * BR-32: the Admin decides where the mid-roll ads of an episode go and how many times they are
 * inserted. The set is replaced as a whole; an empty set goes back to random cues.
 */
@Injectable()
export class EpisodeAdSlotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async slots(episodeId: string): Promise<EpisodeAdSlotsViewDto> {
    const durationSeconds = await this.durationOf(episodeId);
    const slots = await this.prisma.episodeAdSlot.findMany({
      where: { episodeId },
      orderBy: { positionSeconds: 'asc' },
      select: SLOT_SELECT,
    });
    return { episodeId, durationSeconds, mode: slots.length ? 'MANUAL' : 'RANDOM', slots };
  }

  async replace(episodeId: string, actorId: string, dto: SetEpisodeAdSlotsRequestDto): Promise<EpisodeAdSlotsViewDto> {
    const durationSeconds = await this.durationOf(episodeId);
    const positions = dto.slots.map((slot) => slot.positionSeconds);
    if (new Set(positions).size !== positions.length) {
      throw new BadRequestException({
        message: 'Two ad cues cannot share the same second',
        details: { reason: 'AD_SLOT_DUPLICATE' },
      });
    }
    const late = durationSeconds === null ? [] : positions.filter((position) => position >= durationSeconds);
    if (late.length) {
      throw new BadRequestException({
        message: 'An ad cue lies past the end of the episode',
        details: { reason: 'AD_SLOT_OUT_OF_RANGE', durationSeconds, positions: late },
      });
    }
    const adIds = [...new Set(dto.slots.flatMap((slot) => (slot.adId ? [slot.adId] : [])))];
    if (adIds.length) {
      const found = await this.prisma.ad.count({ where: { id: { in: adIds } } });
      if (found !== adIds.length) {
        throw new NotFoundException({ message: 'Ad not found', details: { reason: 'AD_NOT_FOUND' } });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.episodeAdSlot.deleteMany({ where: { episodeId } });
      if (dto.slots.length) {
        await tx.episodeAdSlot.createMany({
          data: dto.slots.map((slot) => ({
            episodeId,
            positionSeconds: slot.positionSeconds,
            adId: slot.adId ?? null,
            createdById: actorId,
          })),
        });
      }
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.EPISODE_AD_SLOTS_SET,
          entityType: 'Episode',
          entityId: episodeId,
          projectId: null,
          actorId,
          payload: {
            slots: dto.slots.map((slot) => ({ positionSeconds: slot.positionSeconds, adId: slot.adId ?? null })),
          },
        },
        tx,
      );
    });
    return this.slots(episodeId);
  }

  /** The approved version's length, so a cue can be checked against it; null before one exists. */
  private async durationOf(episodeId: string): Promise<number | null> {
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      select: { approvedMediaAsset: { select: { durationSeconds: true } } },
    });
    if (!episode) {
      throw new NotFoundException({ message: 'Episode not found', details: { reason: 'EPISODE_NOT_FOUND' } });
    }
    return episode.approvedMediaAsset?.durationSeconds ?? null;
  }
}
