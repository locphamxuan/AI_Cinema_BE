import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Movie, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AccessControlService } from 'src/modules/identity/access-control/access-control.service';

/**
 * Who may touch a movie project, on top of the endpoint permission:
 * - read: its Reviewer, its assigned Creator, or anyone holding project:read.all (Admin);
 * - reviewer: only the Reviewer who owns it;
 * - creator: only the Creator it is assigned to (BR-15).
 * Someone who may not read a project gets 404, so ids of other projects reveal nothing.
 */
export type ProjectRole = 'read' | 'reviewer' | 'creator';

@Injectable()
export class ProjectAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** Projects the caller may list. */
  async readableWhere(user: AuthenticatedUser): Promise<Prisma.MovieWhereInput> {
    if (await this.readsAll(user)) return {};
    return { OR: [{ reviewerId: user.id }, { creatorId: user.id }] };
  }

  async movie(movieId: string, user: AuthenticatedUser, role: ProjectRole, tx?: PrismaTx): Promise<Movie> {
    const movie = await (tx ?? this.prisma).movie.findUnique({ where: { id: movieId } });
    if (!movie || !(await this.canRead(movie, user))) throw new NotFoundException('Movie project not found');
    this.assertRole(movie, user, role);
    return movie;
  }

  /** The episode with its movie, checked the same way as the movie. */
  async episode(episodeId: string, user: AuthenticatedUser, role: ProjectRole, tx?: PrismaTx) {
    const episode = await (tx ?? this.prisma).episode.findUnique({
      where: { id: episodeId },
      include: { movie: true },
    });
    if (!episode || !(await this.canRead(episode.movie, user))) throw new NotFoundException('Episode not found');
    this.assertRole(episode.movie, user, role);
    return episode;
  }

  async mediaAsset(mediaAssetId: string, user: AuthenticatedUser, role: ProjectRole, tx?: PrismaTx) {
    const asset = await (tx ?? this.prisma).mediaAsset.findUnique({
      where: { id: mediaAssetId },
      include: { episode: { include: { movie: true } } },
    });
    if (!asset || !(await this.canRead(asset.episode.movie, user))) throw new NotFoundException('Media not found');
    this.assertRole(asset.episode.movie, user, role);
    return asset;
  }

  private async canRead(movie: Movie, user: AuthenticatedUser): Promise<boolean> {
    return movie.reviewerId === user.id || movie.creatorId === user.id || this.readsAll(user);
  }

  private async readsAll(user: AuthenticatedUser): Promise<boolean> {
    return (await this.accessControl.permissionsOf(user.role)).has(PERMISSION.PROJECT_READ_ALL);
  }

  private assertRole(movie: Movie, user: AuthenticatedUser, role: ProjectRole): void {
    if (role === 'reviewer' && movie.reviewerId !== user.id) {
      throw new ForbiddenException('Only the Content Reviewer in charge of this project can do that');
    }
    if (role === 'creator' && movie.creatorId !== user.id) {
      throw new ForbiddenException('This project is not assigned to you');
    }
  }
}
