import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Movie, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AccessControlService } from 'src/modules/identity/access-control/access-control.service';

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
  async readableWhere(user: AuthenticatedUser): Promise<Prisma.MovieWhereInput> {
    if (await this.readsAll(user)) return {};
    return {
      OR: [
        { reviewerId: user.id },
        { creatorId: user.id },
        { creatorAssignments: { some: { creatorId: user.id, isActive: true } } },
      ],
    };
  }

  async movie(movieId: string, user: AuthenticatedUser, role: ProjectRole, tx?: PrismaTx): Promise<Movie> {
    const movie = await (tx ?? this.prisma).movie.findUnique({ where: { id: movieId } });
    if (!movie || !(await this.canRead(movie, user, tx))) throw new NotFoundException('Movie project not found');
    await this.assertRole(movie, user, role, tx);
    return movie;
  }

  /** The episode with its movie, checked the same way as the movie. */
  async episode(episodeId: string, user: AuthenticatedUser, role: ProjectRole, tx?: PrismaTx) {
    const episode = await (tx ?? this.prisma).episode.findUnique({
      where: { id: episodeId },
      include: { movie: true },
    });
    if (!episode || !(await this.canRead(episode.movie, user, tx))) throw new NotFoundException('Episode not found');
    await this.assertRole(episode.movie, user, role, tx);
    this.assertEpisodeOwner(episode, user, role);
    return episode;
  }

  async mediaAsset(mediaAssetId: string, user: AuthenticatedUser, role: ProjectRole, tx?: PrismaTx) {
    const asset = await (tx ?? this.prisma).mediaAsset.findUnique({
      where: { id: mediaAssetId },
      include: { episode: { include: { movie: true } } },
    });
    if (!asset || !(await this.canRead(asset.episode.movie, user, tx))) throw new NotFoundException('Media not found');
    await this.assertRole(asset.episode.movie, user, role, tx);
    this.assertEpisodeOwner(asset.episode, user, role);
    return asset;
  }

  /** The lead Creator or a Creator with an active assignment on the project. */
  async isOnTeam(movie: Pick<Movie, 'id' | 'creatorId'>, userId: string, tx?: PrismaTx): Promise<boolean> {
    if (movie.creatorId === userId) return true;
    const seat = await (tx ?? this.prisma).projectCreatorAssignment.count({
      where: { movieId: movie.id, creatorId: userId, isActive: true },
    });
    return seat > 0;
  }

  private async canRead(movie: Movie, user: AuthenticatedUser, tx?: PrismaTx): Promise<boolean> {
    return movie.reviewerId === user.id || (await this.isOnTeam(movie, user.id, tx)) || this.readsAll(user);
  }

  private async readsAll(user: AuthenticatedUser): Promise<boolean> {
    return (await this.accessControl.permissionsOf(user.role)).has(PERMISSION.PROJECT_READ_ALL);
  }

  private async assertRole(movie: Movie, user: AuthenticatedUser, role: ProjectRole, tx?: PrismaTx): Promise<void> {
    if (role === 'reviewer' && movie.reviewerId !== user.id) {
      throw new ForbiddenException('Only the Content Reviewer in charge of this project can do that');
    }
    if (role === 'creator' && !(await this.isOnTeam(movie, user.id, tx))) {
      throw new ForbiddenException('This project is not assigned to you');
    }
    if (role === 'lead' && movie.creatorId !== user.id) {
      throw new ForbiddenException('Only the lead Creator of this project can do that');
    }
  }

  private assertEpisodeOwner(
    episode: { assignedCreatorId: string | null; movie: Pick<Movie, 'creatorId'> },
    user: AuthenticatedUser,
    role: ProjectRole,
  ): void {
    const { assignedCreatorId, movie } = episode;
    if (role === 'creator' && assignedCreatorId !== user.id && movie.creatorId !== user.id) {
      throw new ForbiddenException(
        assignedCreatorId ? 'This episode is assigned to another Creator' : 'This episode belongs to the lead Creator',
      );
    }
  }
}
