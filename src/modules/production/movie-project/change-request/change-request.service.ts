import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ChangeRequestStatus, MovieStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus } from 'src/modules/production/project-access/project-rules';
import type { ProposeChangeRequestDto, ResolveChangeRequestDto } from './dto/change-request.request.dto';

const PERSON = { select: { id: true, fullName: true } } as const;

/**
 * BR-55: the Admin reads any project and proposes changes; only the Reviewer in charge
 * changes the project, then accepts or rejects (with a reason) the proposal.
 */
@Injectable()
export class ChangeRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  async propose(movieId: string, dto: ProposeChangeRequestDto, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'read');
    assertProjectStatus(
      movie.status,
      [
        MovieStatus.DRAFT,
        MovieStatus.ASSIGNED,
        MovieStatus.IN_PRODUCTION,
        MovieStatus.COMPLETED,
        MovieStatus.UNDER_REVISION,
      ],
      'propose a change',
    );
    if (dto.episodeId && !(await this.prisma.episode.count({ where: { id: dto.episodeId, movieId } }))) {
      throw new BadRequestException('The episode does not belong to this project');
    }

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.projectChangeRequest.create({
        data: { movieId, episodeId: dto.episodeId, requestedById: user.id, content: dto.content.trim() },
      });
      await this.notifications.notify(
        [movie.reviewerId],
        {
          type: NOTIFICATION_TYPE.CHANGE_REQUESTED,
          title: `The Admin proposed a change to "${movie.title}"`,
          body: dto.content,
          link: `/projects/${movieId}/change-requests`,
          payload: { movieId, changeRequestId: request.id },
        },
        tx,
      );
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_CHANGE_REQUESTED,
          entityType: 'ProjectChangeRequest',
          entityId: request.id,
          movieId,
          actorId: user.id,
        },
        tx,
      );
      return request;
    });
  }

  async list(movieId: string, user: AuthenticatedUser) {
    await this.access.movie(movieId, user, 'read');
    return this.prisma.projectChangeRequest.findMany({
      where: { movieId },
      orderBy: { createdAt: 'desc' },
      include: {
        requestedBy: PERSON,
        resolvedBy: PERSON,
        episode: { select: { id: true, episodeNumber: true, title: true } },
      },
    });
  }

  async resolve(changeRequestId: string, accept: boolean, dto: ResolveChangeRequestDto, user: AuthenticatedUser) {
    const request = await this.prisma.projectChangeRequest.findUnique({ where: { id: changeRequestId } });
    if (!request) throw new NotFoundException('Change request not found');
    const movie = await this.access.movie(request.movieId, user, 'reviewer');
    if (!accept && !dto.response?.trim()) throw new BadRequestException('Explain why the proposal is rejected');

    const status = accept ? ChangeRequestStatus.ACCEPTED : ChangeRequestStatus.REJECTED;
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.projectChangeRequest.updateMany({
        where: { id: changeRequestId, status: ChangeRequestStatus.OPEN },
        data: { status, reviewerResponse: dto.response?.trim(), resolvedById: user.id, resolvedAt: new Date() },
      });
      if (count === 0) throw new ConflictException('This change request was already answered');
      await this.notifications.notify(
        [request.requestedById],
        {
          type: NOTIFICATION_TYPE.CHANGE_RESOLVED,
          title: `Your proposal for "${movie.title}" was ${accept ? 'accepted' : 'rejected'}`,
          body: dto.response,
          link: `/projects/${movie.id}/change-requests`,
          payload: { movieId: movie.id, changeRequestId },
        },
        tx,
      );
      await this.auditLog.record(
        {
          action: accept ? CONTENT_EVENT.PROJECT_CHANGE_ACCEPTED : CONTENT_EVENT.PROJECT_CHANGE_REJECTED,
          entityType: 'ProjectChangeRequest',
          entityId: changeRequestId,
          movieId: movie.id,
          actorId: user.id,
          payload: { response: dto.response },
        },
        tx,
      );
      return tx.projectChangeRequest.findUniqueOrThrow({ where: { id: changeRequestId } });
    });
  }
}
