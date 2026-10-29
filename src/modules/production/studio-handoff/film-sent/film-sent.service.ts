import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StudioMilestoneStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { FilmSentRequestDto } from './film-sent.request.dto';
import { PROJECT_REF } from 'src/modules/production/project-access/project-relations';

const SEASON_SCOPE = /^Mùa\s+(\d+)$/iu;

/** Hand-offs that can still receive a film: not declined and not replaced by another studio. */
const OPEN: StudioMilestoneStatus[] = [
  StudioMilestoneStatus.BRIEF_SENT,
  StudioMilestoneStatus.STUDIO_ACCEPTED,
  StudioMilestoneStatus.IN_PROGRESS,
  StudioMilestoneStatus.DELIVERED,
];

type ScopeEpisode = { id: string; assignedCreatorId: string | null };

/**
 * BR-58: the studio hands films back by email only, so the Studio Web reports each mail it sent. The hand-off
 * keeps the link of every episode mailed (the Studio tab and the episode page show it) and the Creator and
 * Reviewer are told; the milestone itself moves to DELIVERED once the Submission the Creator uploads is READY
 * (deliverOnSubmission).
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
          project: { movie: { title: dto.movieTitle } },
          // The brief names the Creator who sent it; older briefs named the project's main Creator.
          OR: [
            { createdBy: { email: { equals: dto.creatorEmail, mode: 'insensitive' } } },
            { project: { creator: { email: { equals: dto.creatorEmail, mode: 'insensitive' } } } },
          ],
          ...this.scopeFilter(dto.scope),
        },
        orderBy: { createdAt: 'desc' },
        include: { project: PROJECT_REF },
      });
      if (!handoff) throw new NotFoundException('No open hand-off matches this film');

      const { project } = handoff;
      // The episodes of the scope in the order the brief lists them, so a position in the mail is one episode.
      const scope = await tx.episode.findMany({
        where: { movieId: project.id, ...(handoff.seasonId ? { seasonId: handoff.seasonId } : {}) },
        orderBy: { episodeNumber: 'asc' },
        select: { id: true, assignedCreatorId: true },
      });
      const sentAt = new Date();
      await this.saveLinks(tx, handoff.id, dto, scope, sentAt);

      const label = dto.label ? `${dto.label} ${dto.version}` : dto.version;
      const note = `Studio đã gửi phim qua email: ${label} (${dto.episodes.length} tập).`;
      await tx.studioHandoff.update({ where: { id: handoff.id }, data: { filmSentAt: sentAt, filmSentNote: note } });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.STUDIO_FILM_SENT,
          entityType: 'StudioHandoff',
          entityId: handoff.id,
          projectId: handoff.projectId,
          actorId: null,
          payload: { version: dto.version, episodeCount: dto.episodes.length, scope: dto.scope },
        },
        tx,
      );
      // The Creators given episodes of the scope were CC'd on the brief ("Đồng gửi") and get the film too.
      const recipients = [
        handoff.createdById,
        project.creatorId,
        project.reviewerId,
        ...scope.map((episode) => episode.assignedCreatorId),
      ];
      await this.notifications.notify(
        [...new Set(recipients.filter((id): id is string => !!id))],
        {
          type: NOTIFICATION_TYPE.STUDIO_FILM_SENT,
          title: `Studio đã gửi phim "${project.movie.title}" (${dto.scope})`,
          body: `${note} Creator xem link từng tập ở tab Studio và upload Submission để Reviewer kiểm tra.`,
          link: `/projects/${project.id}/studio`,
          payload: { projectId: project.id, handoffId: handoff.id, version: dto.version },
        },
        tx,
      );
      return { handoffId: handoff.id, sentAt };
    });
  }

  /** One link per episode of the hand-off: a later mail for the same episode replaces it. */
  private async saveLinks(
    tx: Prisma.TransactionClient,
    handoffId: string,
    dto: FilmSentRequestDto,
    scope: ScopeEpisode[],
    sentAt: Date,
  ) {
    const matched = dto.episodes.flatMap((link) => {
      const episode = scope[link.episode - 1];
      return episode ? [{ episodeId: episode.id, link }] : [];
    });
    for (const { episodeId, link } of matched) {
      const data = { version: dto.version, fileName: link.fileName, url: link.url, sentAt };
      await tx.studioFilmLink.upsert({
        where: { handoffId_episodeId: { handoffId, episodeId } },
        create: { handoffId, episodeId, ...data },
        update: data,
      });
    }
  }

  private scopeFilter(scope: string): Prisma.StudioHandoffWhereInput {
    const season = SEASON_SCOPE.exec(scope.trim());
    return season ? { season: { seasonNumber: Number(season[1]) } } : { seasonId: null };
  }
}
