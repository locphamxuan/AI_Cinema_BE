import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StudioMilestoneStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { FilmSentRequestDto } from './film-sent.request.dto';

const SEASON_SCOPE = /^Mùa\s+(\d+)$/iu;

/** Hand-offs that can still receive a film: not declined and not replaced by another studio. */
const OPEN: StudioMilestoneStatus[] = [
  StudioMilestoneStatus.BRIEF_SENT,
  StudioMilestoneStatus.STUDIO_ACCEPTED,
  StudioMilestoneStatus.IN_PROGRESS,
  StudioMilestoneStatus.DELIVERED,
];

/**
 * BR-58: the studio hands films back by email only, so the Studio Web reports each mail it sent. The hand-off
 * remembers it (the Studio tab shows it) and the Creator and Reviewer are told; the milestone itself still moves
 * only when the Creator uploads the Submission.
 */
@Injectable()
export class FilmSentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  async record(dto: FilmSentRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const handoff = await tx.studioHandoff.findFirst({
        where: {
          milestoneStatus: { in: OPEN },
          studio: { email: { equals: dto.studioEmail, mode: 'insensitive' } },
          movie: { title: dto.movieTitle, creator: { email: { equals: dto.creatorEmail, mode: 'insensitive' } } },
          ...this.scopeFilter(dto.scope),
        },
        orderBy: { createdAt: 'desc' },
        include: { movie: { select: { id: true, title: true, creatorId: true, reviewerId: true } } },
      });
      if (!handoff) throw new NotFoundException('No open hand-off matches this film');

      const label = dto.label ? `${dto.label} ${dto.version}` : dto.version;
      const note = `Studio đã gửi phim qua email: ${label} (${dto.episodeCount} tập).`;
      const sentAt = new Date();
      await tx.studioHandoff.update({ where: { id: handoff.id }, data: { filmSentAt: sentAt, filmSentNote: note } });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.STUDIO_FILM_SENT,
          entityType: 'StudioHandoff',
          entityId: handoff.id,
          movieId: handoff.movieId,
          actorId: null,
          payload: { version: dto.version, episodeCount: dto.episodeCount, scope: dto.scope },
        },
        tx,
      );
      const { movie } = handoff;
      await this.notifications.notify(
        [movie.creatorId, movie.reviewerId],
        {
          type: NOTIFICATION_TYPE.STUDIO_FILM_SENT,
          title: `Studio đã gửi phim "${movie.title}" (${dto.scope})`,
          body: `${note} Creator tải phim từ email và upload Submission để Reviewer kiểm tra.`,
          link: `/projects/${movie.id}/studio`,
          payload: { movieId: movie.id, handoffId: handoff.id, version: dto.version },
        },
        tx,
      );
      return { handoffId: handoff.id, sentAt };
    });
  }

  private scopeFilter(scope: string): Prisma.StudioHandoffWhereInput {
    const season = SEASON_SCOPE.exec(scope.trim());
    return season ? { season: { seasonNumber: Number(season[1]) } } : { seasonId: null };
  }
}
