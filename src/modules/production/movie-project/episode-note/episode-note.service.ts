import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ProjectStatus } from '@prisma/client';
import { assertProjectStatus, DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';

/** From the episodes being given out until the movie is done being fixed. */
const NOTE_STATUSES: ProjectStatus[] = [ProjectStatus.ASSIGNED, ...DELIVERY_PROJECT_STATUSES];

export interface EpisodeNote {
  id: string;
  message: string;
  createdAt: Date;
  author: { id: string; fullName: string } | null;
}

/** The text of a note row; a row written without one reads as empty. */
function messageOf(payload: unknown): string {
  const message = (payload as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}

/**
 * BR-67: a co-Creator answers for the episode given to them (checks the studio's film against the brief,
 * declares the AI use, answers the Reviewer's change requests), but only the lead Creator talks to the studio.
 * The two exchange notes on the episode: what the studio must fix goes up to the lead, who passes it on. Notes
 * are content events of the episode, so they need no table of their own and stay in the project history.
 */
@Injectable()
export class EpisodeNoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  /** The notes of an episode, oldest first; anyone who may read the project sees them. */
  async list(episodeId: string, user: AuthenticatedUser): Promise<EpisodeNote[]> {
    await this.access.episode(episodeId, user, 'read');
    const rows = await this.prisma.auditLog.findMany({
      where: { action: CONTENT_EVENT.EPISODE_NOTE_SENT, entityType: 'Episode', entityId: episodeId },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { id: true, fullName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      message: messageOf(row.payload),
      createdAt: row.createdAt,
      author: row.actor,
    }));
  }

  /** The Creator holding the episode writes to the lead, or the lead back to them; the other one is told. */
  async send(episodeId: string, message: string, user: AuthenticatedUser): Promise<EpisodeNote[]> {
    const episode = await this.access.episode(episodeId, user, 'creator');
    const { project } = episode;
    assertProjectStatus(project.status, NOTE_STATUSES, 'send a note on an episode');
    const holder = episode.assignedCreatorId;
    if (!holder || holder === project.creatorId) {
      throw new BadRequestException('The episode is held by the lead Creator: give it to a Creator first');
    }
    if (user.id !== holder && user.id !== project.creatorId) {
      throw new ForbiddenException('Only the Creator holding the episode and the lead Creator exchange notes');
    }
    const text = message.trim();
    if (!text) throw new BadRequestException('Write a message');

    const toLead = user.id === holder;
    await this.prisma.$transaction(async (tx) => {
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.EPISODE_NOTE_SENT,
          entityType: 'Episode',
          entityId: episode.id,
          projectId: project.id,
          actorId: user.id,
          payload: { message: text, toLead },
        },
        tx,
      );
      await this.notifications.notify(
        [toLead ? project.creatorId : holder],
        {
          type: NOTIFICATION_TYPE.EPISODE_NOTE,
          title: toLead
            ? `Creator phụ trách tập ${episode.episodeNumber} gửi ghi chú cho bạn`
            : `Creator chính trả lời về tập ${episode.episodeNumber}`,
          body: text.length > 300 ? `${text.slice(0, 297)}...` : text,
          link: `/projects/${project.id}/episodes/${episode.id}`,
          payload: { projectId: project.id, episodeId: episode.id },
        },
        tx,
      );
    });
    return this.list(episodeId, user);
  }
}
