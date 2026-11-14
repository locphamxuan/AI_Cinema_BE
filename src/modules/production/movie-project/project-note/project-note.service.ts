import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AccessControlService } from 'src/modules/identity/access-control/access-control.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';

export interface ProjectNote {
  id: string;
  message: string;
  createdAt: Date;
  author: { id: string; fullName: string; role: string } | null;
}

function messageOf(payload: unknown): string {
  const message = (payload as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}

/**
 * MF-1 §1 (07/11/2026): the Admin and the lead Creator align on the idea and direction of the movie before the
 * script is written; the Reviewer follows along. Notes are content events of the project, like episode notes,
 * so they need no table of their own and stay in the project history.
 */
@Injectable()
export class ProjectNoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly accessControl: AccessControlService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  async list(projectId: string, user: AuthenticatedUser): Promise<ProjectNote[]> {
    await this.access.project(projectId, user, 'read');
    const rows = await this.prisma.auditLog.findMany({
      where: { action: CONTENT_EVENT.PROJECT_NOTE_SENT, entityType: 'MovieProject', entityId: projectId },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { id: true, fullName: true, role: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      message: messageOf(row.payload),
      createdAt: row.createdAt,
      author: row.actor,
    }));
  }

  /** The Admin, the lead Creator or the Reviewer writes; the other two are told. */
  async send(projectId: string, message: string, user: AuthenticatedUser): Promise<ProjectNote[]> {
    const project = await this.access.project(projectId, user, 'read');
    assertProjectStatus(project.status, [...OPEN_PROJECT_STATUSES, ProjectStatus.UNDER_REVISION], 'send a note');
    const isAdmin = (await this.accessControl.permissionsOf(user.role)).has(PERMISSION.PROJECT_CREATE);
    if (!isAdmin && user.id !== project.creatorId && user.id !== project.reviewerId) {
      throw new ForbiddenException('Only the Admin, the lead Creator and the Reviewer write on the project');
    }
    const text = message.trim();
    if (!text) throw new BadRequestException('Write a message');
    const admins = await this.notifications.adminIds();
    const to = [project.creatorId, project.reviewerId, ...admins].filter((id): id is string => !!id && id !== user.id);
    await this.prisma.$transaction(async (tx) => {
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_NOTE_SENT,
          entityType: 'MovieProject',
          entityId: projectId,
          projectId,
          actorId: user.id,
          payload: { message: text },
        },
        tx,
      );
      await this.notifications.notify(
        [...new Set(to)],
        {
          type: NOTIFICATION_TYPE.PROJECT_NOTE,
          title: `Trao đổi mới về ý tưởng phim "${project.movie.title}"`,
          body: text.length > 300 ? `${text.slice(0, 297)}...` : text,
          link: `/projects/${projectId}`,
          payload: { projectId },
        },
        tx,
      );
    });
    return this.list(projectId, user);
  }
}
