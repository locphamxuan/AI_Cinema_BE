import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { MovieStatus, UserRole, type Movie } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import type { AddCreatorRequestDto, DelegateEpisodesRequestDto } from './dto/project-team.request.dto';

const TEAM_EDITABLE = [...OPEN_PROJECT_STATUSES, MovieStatus.UNDER_REVISION];
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
  async list(movieId: string, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'read');
    const [seats, episodes] = await Promise.all([
      this.prisma.projectCreatorAssignment.findMany({
        where: { movieId },
        orderBy: [{ isActive: 'desc' }, { assignedAt: 'asc' }],
        include: { creator: PERSON, assignedBy: PERSON, delegatedFrom: PERSON },
      }),
      this.prisma.episode.findMany({
        where: { movieId, assignedCreatorId: { not: null } },
        select: { id: true, episodeNumber: true, title: true, assignedCreatorId: true },
        orderBy: { episodeNumber: 'asc' },
      }),
    ]);
    return seats.map((seat) => ({
      ...seat,
      isLead: seat.creatorId === movie.creatorId,
      episodes: episodes.filter((episode) => episode.assignedCreatorId === seat.creatorId),
    }));
  }

  async addCreator(movieId: string, dto: AddCreatorRequestDto, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'reviewer');
    assertProjectStatus(movie.status, TEAM_EDITABLE, 'add a Creator');
    if (!movie.creatorId) throw new ConflictException('Assign the lead Content Creator first');
    await this.assertCreator(dto.creatorId);
    await this.prisma.$transaction(async (tx) => {
      await this.seat(tx, movie, dto.creatorId, { assignedById: user.id, note: dto.note });
      await this.record(tx, CONTENT_EVENT.CREATOR_ADDED, movie.id, user.id, { creatorId: dto.creatorId });
      await this.tell(tx, dto.creatorId, movie, `Bạn được thêm vào dự án phim "${movie.title}"`);
    });
    return this.list(movieId, user);
  }

  /** The lead is replaced through "assign"; anyone else can leave, and their episodes go back to the team. */
  async removeCreator(movieId: string, creatorId: string, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'reviewer');
    assertProjectStatus(movie.status, TEAM_EDITABLE, 'remove a Creator');
    if (movie.creatorId === creatorId) {
      throw new ConflictException('The lead Creator is replaced by assigning another one');
    }
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.release(tx, movieId, creatorId))) {
        throw new BadRequestException('That Creator is not on this project');
      }
      await this.record(tx, CONTENT_EVENT.CREATOR_REMOVED, movieId, user.id, { creatorId });
    });
    return this.list(movieId, user);
  }

  /** Creator 1 hands episodes to Creator 2; the new Creator joins the team and the seat remembers who delegated. */
  async delegate(movieId: string, dto: DelegateEpisodesRequestDto, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'creator');
    assertProjectStatus(movie.status, TEAM_EDITABLE, 'delegate episodes');
    if (dto.toCreatorId === user.id) throw new BadRequestException('Pick another Creator to delegate to');
    await this.assertCreator(dto.toCreatorId);
    const episodes = await this.prisma.episode.findMany({ where: { movieId, id: { in: dto.episodeIds } } });
    if (episodes.length !== dto.episodeIds.length) throw new BadRequestException('An episode is not in this project');
    const isLead = movie.creatorId === user.id;
    if (episodes.some((e) => e.assignedCreatorId !== user.id && !(isLead && !e.assignedCreatorId))) {
      throw new ForbiddenException('You can only delegate episodes that are yours');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.seat(tx, movie, dto.toCreatorId, { assignedById: user.id, delegatedFromId: user.id, note: dto.note });
      await tx.episode.updateMany({
        where: { id: { in: dto.episodeIds } },
        data: { assignedCreatorId: dto.toCreatorId },
      });
      await this.record(tx, CONTENT_EVENT.EPISODE_DELEGATED, movieId, user.id, {
        toCreatorId: dto.toCreatorId,
        episodeIds: dto.episodeIds,
      });
      await this.tell(
        tx,
        dto.toCreatorId,
        movie,
        `${user.id === movie.creatorId ? 'Creator chính' : 'Creator'} giao tập cho bạn trong phim "${movie.title}"`,
      );
    });
    return this.list(movieId, user);
  }

  /** The Reviewer or the lead Creator gives one episode to a Creator of the project, or back to the team. */
  async assignEpisode(episodeId: string, creatorId: string | null | undefined, user: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, user, 'read');
    const { movie } = episode;
    if (movie.reviewerId !== user.id && movie.creatorId !== user.id) {
      throw new ForbiddenException('Only the Reviewer or the lead Creator can give an episode to a Creator');
    }
    assertProjectStatus(movie.status, TEAM_EDITABLE, 'assign an episode');
    if (creatorId && !(await this.access.isOnTeam(movie, creatorId))) {
      throw new BadRequestException('That Creator is not on this project');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.episode.update({
        where: { id: episodeId },
        data: { assignedCreatorId: creatorId ?? null },
      });
      await this.record(tx, CONTENT_EVENT.EPISODE_ASSIGNED, movie.id, user.id, {
        episodeId,
        creatorId: creatorId ?? null,
      });
      if (creatorId) {
        await this.tell(
          tx,
          creatorId,
          movie,
          `Bạn phụ trách tập ${episode.episodeNumber} của phim "${movie.title}"`,
          NOTIFICATION_TYPE.EPISODE_ASSIGNED,
        );
      }
      return updated;
    });
  }

  /** The seat of a Creator on a project; an existing active seat is kept. */
  async seat(
    tx: PrismaTx,
    movie: Pick<Movie, 'id'>,
    creatorId: string,
    by: { assignedById: string; delegatedFromId?: string; note?: string },
  ) {
    const existing = await tx.projectCreatorAssignment.findFirst({
      where: { movieId: movie.id, creatorId, isActive: true },
    });
    if (existing) return existing;
    return tx.projectCreatorAssignment.create({
      data: { movieId: movie.id, creatorId, note: by.note?.trim(), ...by },
    });
  }

  /** Ends a seat and returns the episodes of that Creator to the team; false when there was no seat. */
  async release(tx: PrismaTx, movieId: string, creatorId: string): Promise<boolean> {
    const { count } = await tx.projectCreatorAssignment.updateMany({
      where: { movieId, creatorId, isActive: true },
      data: { isActive: false, unassignedAt: new Date() },
    });
    await tx.episode.updateMany({
      where: { movieId, assignedCreatorId: creatorId },
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
    movieId: string,
    actorId: string,
    payload: Record<string, unknown>,
  ) {
    return this.auditLog.record(
      { action, entityType: 'ProjectCreatorAssignment', entityId: movieId, movieId, actorId, payload },
      tx,
    );
  }

  private tell(
    tx: PrismaTx,
    creatorId: string,
    movie: Pick<Movie, 'id'>,
    title: string,
    type: (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE] = NOTIFICATION_TYPE.PROJECT_ASSIGNED,
  ) {
    return this.notifications.notify(
      [creatorId],
      { type, title, link: `/projects/${movie.id}`, payload: { movieId: movie.id } },
      tx,
    );
  }
}
