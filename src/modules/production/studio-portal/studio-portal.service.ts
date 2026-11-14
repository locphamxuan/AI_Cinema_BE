import { Injectable } from '@nestjs/common';
import { ContentReviewDecision, ScriptStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { StudioAccountService } from 'src/modules/production/studio/studio-account.service';

/**
 * What a logged-in studio sees (MF-1, 07/11/2026): the projects it was sent a contract for, their Final Script,
 * the episodes it owes with their deadlines, and the Reviewer's change requests on what it delivered. Nothing
 * of other studios, budgets or the internal team leaks through here.
 */
@Injectable()
export class StudioPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly accounts: StudioAccountService,
  ) {}

  studioOf(user: AuthenticatedUser): Promise<string> {
    return this.accounts.studioOf(user);
  }

  async me(user: AuthenticatedUser) {
    const studioId = await this.accounts.studioOf(user);
    return this.prisma.studio.findUniqueOrThrow({
      where: { id: studioId },
      select: { id: true, name: true, email: true, contactName: true, phone: true },
    });
  }

  async projects(user: AuthenticatedUser) {
    const studioId = await this.accounts.studioOf(user);
    const projects = await this.prisma.movieProject.findMany({
      where: { studioId, contracts: { some: { studioId } } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        status: true,
        handedOffAt: true,
        movie: { select: { title: true, _count: { select: { episodes: true } } } },
        contracts: {
          where: { studioId },
          orderBy: { round: 'desc' },
          take: 1,
          select: { id: true, status: true, costVnd: true },
        },
      },
    });
    return projects.map(({ movie, contracts, ...project }) => ({
      ...project,
      title: movie.title,
      episodeCount: movie._count.episodes,
      contract: contracts[0] ?? null,
    }));
  }

  async project(projectId: string, user: AuthenticatedUser) {
    const studioId = await this.accounts.studioOf(user);
    await this.access.studioProject(projectId, studioId);
    const project = await this.prisma.movieProject.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        id: true,
        status: true,
        ideaDescription: true,
        handedOffAt: true,
        movie: { select: { title: true, synopsis: true, ageRating: true, defaultLanguage: true } },
        script: {
          select: {
            status: true,
            finalizedAt: true,
            currentVersion: true,
            versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, content: true } },
          },
        },
        contracts: { where: { studioId }, orderBy: { round: 'asc' } },
      },
    });
    const episodes = await this.prisma.episode.findMany({
      where: { movieId: projectId },
      orderBy: { episodeNumber: 'asc' },
      select: {
        id: true,
        episodeNumber: true,
        title: true,
        synopsis: true,
        status: true,
        targetDurationSeconds: true,
        deliveryDeadline: true,
        dueDate: true,
        mediaAssets: {
          orderBy: { version: 'desc' },
          take: 1,
          select: {
            id: true,
            version: true,
            ingestStatus: true,
            failureReason: true,
            createdAt: true,
            contentReviews: {
              where: { decision: ContentReviewDecision.CHANGES_REQUESTED },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { comments: true, createdAt: true },
            },
          },
        },
      },
    });
    const { movie, script, ...rest } = project;
    const finalScript = script?.status === ScriptStatus.FINAL ? (script.versions[0] ?? null) : null;
    return {
      ...rest,
      ...movie,
      finalScript,
      episodes: episodes.map(({ mediaAssets, ...episode }) => {
        const latest = mediaAssets[0];
        return {
          ...episode,
          latestDelivery: latest
            ? { ...latest, contentReviews: undefined, changeRequest: latest.contentReviews[0] ?? null }
            : null,
        };
      }),
    };
  }
}
