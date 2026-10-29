import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MovieProject, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AccessControlService } from 'src/modules/identity/access-control/access-control.service';
import { liftProject, WITH_PROJECT } from './project-relations';

/** A project with the title of its catalog movie, which every message about it names. */
const WITH_TITLE = { movie: { select: { title: true } } } satisfies Prisma.MovieProjectInclude;
export type TitledProject = Prisma.MovieProjectGetPayload<{ include: typeof WITH_TITLE }>;

/**
 * Who may touch a movie project, on top of the endpoint permission:
 * - read: its Reviewer, a Creator of its team, or anyone holding project:read.all (Admin);
 * - reviewer: only the Reviewer who owns it;
 * - creator: its lead Creator or a Creator holding an active assignment (BR-13); an episode is worked on by
 *   the Creator it was given to or the lead, and one not given to anyone belongs to the lead;
 * - lead: only the lead Creator, who speaks for the team to the studio (hand-off, studio change, milestones,
 *   asking for Token). The other Creators are CC'd on the brief and pass their episodes up to the lead.
 * Someone who may not read a project gets 404, so ids of other projects reveal nothing.
 */
export type ProjectRole = 'read' | 'reviewer' | 'creator' | 'lead';

@Injectable()
export class ProjectAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** Projects the caller may list. */
  async readableWhere(user: AuthenticatedUser): Promise<Prisma.MovieProjectWhereInput> {
    if (await this.readsAll(user)) return {};
    return {
      OR: [
        { reviewerId: user.id },
        { creatorId: user.id },
        { creatorAssignments: { some: { creatorId: user.id, isActive: true } } },
      ],
    };
  }

  async project(projectId: string, user: AuthenticatedUser, role: ProjectRole, tx?: PrismaTx): Promise<TitledProject> {
    const project = await (tx ?? this.prisma).movieProject.findUnique({
      where: { id: projectId },
      include: WITH_TITLE,
    });
    if (!project || !(await this.canRead(project, user, tx))) throw new NotFoundException('Movie project not found');
    await this.assertRole(project, user, role, tx);
    return project;
  }

  /** The episode with its movie and project, checked the same way as the project. */
  async episode(episodeId: string, user: AuthenticatedUser, role: ProjectRole, tx?: PrismaTx) {
    const found = await (tx ?? this.prisma).episode.findUnique({ where: { id: episodeId }, include: WITH_PROJECT });
    const episode = found && liftProject(found);
    if (!episode || !(await this.canRead(episode.project, user, tx))) throw new NotFoundException('Episode not found');
    await this.assertRole(episode.project, user, role, tx);
    this.assertEpisodeOwner(episode, user, role);
    return episode;
  }

  async mediaAsset(mediaAssetId: string, user: AuthenticatedUser, role: ProjectRole, tx?: PrismaTx) {
    const found = await (tx ?? this.prisma).mediaAsset.findUnique({
      where: { id: mediaAssetId },
      include: { episode: { include: WITH_PROJECT } },
    });
    const asset = found && { ...found, episode: liftProject(found.episode) };
    if (!asset || !(await this.canRead(asset.episode.project, user, tx)))
      throw new NotFoundException('Media not found');
    await this.assertRole(asset.episode.project, user, role, tx);
    this.assertEpisodeOwner(asset.episode, user, role);
    return asset;
  }

  /** The lead Creator or a Creator with an active assignment on the project. */
  async isOnTeam(project: Pick<MovieProject, 'id' | 'creatorId'>, userId: string, tx?: PrismaTx): Promise<boolean> {
    if (project.creatorId === userId) return true;
    const seat = await (tx ?? this.prisma).projectCreatorAssignment.count({
      where: { projectId: project.id, creatorId: userId, isActive: true },
    });
    return seat > 0;
  }

  private async canRead(project: MovieProject, user: AuthenticatedUser, tx?: PrismaTx): Promise<boolean> {
    return project.reviewerId === user.id || (await this.isOnTeam(project, user.id, tx)) || this.readsAll(user);
  }

  private async readsAll(user: AuthenticatedUser): Promise<boolean> {
    return (await this.accessControl.permissionsOf(user.role)).has(PERMISSION.PROJECT_READ_ALL);
  }

  private async assertRole(
    project: MovieProject,
    user: AuthenticatedUser,
    role: ProjectRole,
    tx?: PrismaTx,
  ): Promise<void> {
    if (role === 'reviewer' && project.reviewerId !== user.id) {
      throw new ForbiddenException('Only the Content Reviewer in charge of this project can do that');
    }
    if (role === 'creator' && !(await this.isOnTeam(project, user.id, tx))) {
      throw new ForbiddenException('This project is not assigned to you');
    }
    if (role === 'lead' && project.creatorId !== user.id) {
      throw new ForbiddenException('Only the lead Creator of this project can do that');
    }
  }

  private assertEpisodeOwner(
    episode: { assignedCreatorId: string | null; project: Pick<MovieProject, 'creatorId'> },
    user: AuthenticatedUser,
    role: ProjectRole,
  ): void {
    const { assignedCreatorId, project } = episode;
    if (role === 'creator' && assignedCreatorId !== user.id && project.creatorId !== user.id) {
      throw new ForbiddenException(
        assignedCreatorId ? 'This episode is assigned to another Creator' : 'This episode belongs to the lead Creator',
      );
    }
  }
}
