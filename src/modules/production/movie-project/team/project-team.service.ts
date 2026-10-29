import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ProjectStatus, UserRole, type MovieProject } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import type { AddCreatorRequestDto, DelegateEpisodesRequestDto } from './dto/project-team.request.dto';

const TEAM_EDITABLE = [...OPEN_PROJECT_STATUSES, ProjectStatus.UNDER_REVISION];
const PERSON = { select: { id: true, fullName: true, email: true } } as const;

/** The Creators of a project: the lead, the ones added next to them, who delegated to whom, and who has which episode (BR-13). */
@Injectable()
export class ProjectTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** The Creators one can pick from: Reviewers and Creators do not hold user:read, so this lists only what they need. */
  directory() {
    return this.prisma.user.findMany({
      where: { role: UserRole.CONTENT_CREATOR, isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, email: true },
    });
  }

  /** Every seat, active first, with the episodes each Creator holds. */
  async list(projectId: string, user: AuthenticatedUser) {
    const project = await this.access.project(projectId, user, 'read');
    const [seats, episodes] = await Promise.all([
      this.prisma.projectCreatorAssignment.findMany({
        where: { projectId },
        orderBy: [{ isActive: 'desc' }, { assignedAt: 'asc' }],
        include: { creator: PERSON, assignedBy: PERSON, delegatedFrom: PERSON },
      }),
      this.prisma.episode.findMany({
        where: { movieId: projectId, assignedCreatorId: { not: null } },
        select: { id: true, episodeNumber: true, title: true, assignedCreatorId: true },
        orderBy: { episodeNumber: 'asc' },
      }),
    ]);
    return seats.map((seat) => ({
      ...seat,
      isLead: seat.creatorId === project.creatorId,
      episodes: episodes.filter((episode) => episode.assignedCreatorId === seat.creatorId),
    }));
  }

  async addCreator(projectId: string, dto: AddCreatorRequestDto, user: AuthenticatedUser) {
    const project = await this.access.project(projectId, user, 'reviewer');
    assertProjectStatus(project.status, TEAM_EDITABLE, 'add a Creator');
    if (!project.creatorId) throw new ConflictException('Assign the lead Content Creator first');
    await this.assertCreator(dto.creatorId);
    await this.prisma.$transaction(async (tx) => {
      await this.seat(tx, project, dto.creatorId, { assignedById: user.id, note: dto.note });
      await this.record(tx, CONTENT_EVENT.CREATOR_ADDED, project.id, user.id, { creatorId: dto.creatorId });
      await this.tell(tx, dto.creatorId, project, `Bạn được thêm vào dự án phim "${project.movie.title}"`);
    });
    return this.list(projectId, user);
  }

  /** The lead is replaced through "assign"; anyone else can leave, and their episodes go back to the team. */
  async removeCreator(projectId: string, creatorId: string, user: AuthenticatedUser) {
    const project = await this.access.project(projectId, user, 'reviewer');
    assertProjectStatus(project.status, TEAM_EDITABLE, 'remove a Creator');
    if (project.creatorId === creatorId) {
      throw new ConflictException('The lead Creator is replaced by assigning another one');
    }
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.release(tx, projectId, creatorId))) {
        throw new BadRequestException('That Creator is not on this project');
      }
      await this.record(tx, CONTENT_EVENT.CREATOR_REMOVED, projectId, user.id, { creatorId });
    });
    return this.list(projectId, user);
  }

  /** Creator 1 hands episodes to Creator 2; the new Creator joins the team and the seat remembers who delegated. */
  async delegate(projectId: string, dto: DelegateEpisodesRequestDto, user: AuthenticatedUser) {
    const project = await this.access.project(projectId, user, 'creator');
    assertProjectStatus(project.status, TEAM_EDITABLE, 'delegate episodes');
    if (dto.toCreatorId === user.id) throw new BadRequestException('Pick another Creator to delegate to');
    await this.assertCreator(dto.toCreatorId);
    const episodes = await this.prisma.episode.findMany({ where: { movieId: projectId, id: { in: dto.episodeIds } } });
    if (episodes.length !== dto.episodeIds.length) throw new BadRequestException('An episode is not in this project');
    const isLead = project.creatorId === user.id;
    if (episodes.some((e) => e.assignedCreatorId !== user.id && !(isLead && !e.assignedCreatorId))) {
      throw new ForbiddenException('You can only delegate episodes that are yours');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.seat(tx, project, dto.toCreatorId, {
        assignedById: user.id,
        delegatedFromId: user.id,
        note: dto.note,
      });
      await tx.episode.updateMany({
        where: { id: { in: dto.episodeIds } },
        data: { assignedCreatorId: dto.toCreatorId },
      });
      await this.record(tx, CONTENT_EVENT.EPISODE_DELEGATED, projectId, user.id, {
        toCreatorId: dto.toCreatorId,
        episodeIds: dto.episodeIds,
      });
      await this.tell(
        tx,
        dto.toCreatorId,
        project,
        `${user.id === project.creatorId ? 'Creator chính' : 'Creator'} giao tập cho bạn trong phim "${project.movie.title}"`,
      );
    });
    return this.list(projectId, user);
  }

  /** The Reviewer or the lead Creator gives one episode to a Creator of the project, or back to the team. */
  async assignEpisode(episodeId: string, creatorId: string | null | undefined, user: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, user, 'read');
    const { project } = episode;
    if (project.reviewerId !== user.id && project.creatorId !== user.id) {
      throw new ForbiddenException('Only the Reviewer or the lead Creator can give an episode to a Creator');
    }
    assertProjectStatus(project.status, TEAM_EDITABLE, 'assign an episode');
    if (creatorId && !(await this.access.isOnTeam(project, creatorId))) {
      throw new BadRequestException('That Creator is not on this project');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.episode.update({
        where: { id: episodeId },
        data: { assignedCreatorId: creatorId ?? null },
      });
      await this.record(tx, CONTENT_EVENT.EPISODE_ASSIGNED, project.id, user.id, {
        episodeId,
        creatorId: creatorId ?? null,
      });
      if (creatorId) {
        await this.tell(
          tx,
          creatorId,
          project,
          `Bạn phụ trách tập ${episode.episodeNumber} của phim "${episode.movie.title}"`,
          NOTIFICATION_TYPE.EPISODE_ASSIGNED,
        );
      }
      return updated;
    });
  }

  /** The seat of a Creator on a project; an existing active seat is kept. */
  async seat(
    tx: PrismaTx,
    project: Pick<MovieProject, 'id'>,
    creatorId: string,
    by: { assignedById: string; delegatedFromId?: string; note?: string },
  ) {
    const existing = await tx.projectCreatorAssignment.findFirst({
      where: { projectId: project.id, creatorId, isActive: true },
    });
    if (existing) return existing;
    return tx.projectCreatorAssignment.create({
      data: { projectId: project.id, creatorId, note: by.note?.trim(), ...by },
    });
  }

  /** Ends a seat and returns the episodes of that Creator to the team; false when there was no seat. */
  async release(tx: PrismaTx, projectId: string, creatorId: string): Promise<boolean> {
    const { count } = await tx.projectCreatorAssignment.updateMany({
      where: { projectId, creatorId, isActive: true },
      data: { isActive: false, unassignedAt: new Date() },
    });
    await tx.episode.updateMany({
      where: { movieId: projectId, assignedCreatorId: creatorId },
      data: { assignedCreatorId: null },
    });
    return count > 0;
  }

  private async assertCreator(creatorId: string) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { role: true, isActive: true },
    });
    if (creator?.role !== UserRole.CONTENT_CREATOR || !creator.isActive) {
      throw new BadRequestException('Pick an active Content Creator account');
    }
  }

  private record(
    tx: PrismaTx,
    action: (typeof CONTENT_EVENT)[keyof typeof CONTENT_EVENT],
    projectId: string,
    actorId: string,
    payload: Record<string, unknown>,
  ) {
    return this.auditLog.record(
      { action, entityType: 'ProjectCreatorAssignment', entityId: projectId, projectId, actorId, payload },
      tx,
    );
  }

  private tell(
    tx: PrismaTx,
    creatorId: string,
    project: Pick<MovieProject, 'id'>,
    title: string,
    type: (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE] = NOTIFICATION_TYPE.PROJECT_ASSIGNED,
  ) {
    return this.notifications.notify(
      [creatorId],
      { type, title, link: `/projects/${project.id}`, payload: { projectId: project.id } },
      tx,
    );
  }
}
