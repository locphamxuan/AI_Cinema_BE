import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ComplianceResult,
  EpisodeStatus,
  MovieStatus,
  type Episode,
  type Movie,
  type Publication,
  UnpublishMode,
} from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/audit-log/content-events';
import { ProjectLifecycleService } from 'src/modules/movie-project/project-lifecycle.service';
import { NotificationService } from 'src/modules/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/notification/notification-types';
import { ProjectAccessService } from 'src/modules/project-access/project-access.service';
import {
  assertEpisodeStatus,
  assertProjectStatus,
  DELIVERY_PROJECT_STATUSES,
} from 'src/modules/project-access/project-rules';
import type { PublishEpisodeRequestDto, UnpublishRequestDto } from './dto/publishing.request.dto';
import { EpisodeRevisionService } from './episode-revision.service';

/** A project releases episodes while the studio delivers, while it is fixed, and once complete. */
const RELEASING_PROJECT: MovieStatus[] = [...DELIVERY_PROJECT_STATUSES, MovieStatus.COMPLETED];

/** Releasable: checked and never released, taken down earlier, or already scheduled (reschedule). */
const RELEASABLE: EpisodeStatus[] = [
  EpisodeStatus.COMPLIANCE_PASSED,
  EpisodeStatus.UNPUBLISHED,
  EpisodeStatus.SCHEDULED,
];

const COMPLIANCE_ITEMS = 4;

type EpisodeWithMovie = Episode & { movie: Movie };

/**
 * MF-1 steps 12–16: schedule or publish an episode with its reviewed version (BR-14, BR-19),
 * take it down, and complete the project once every episode is out (BR-38). The same gate is
 * enforced by database triggers, so no other code path can publish around it.
 */
@Injectable()
export class PublicationService {
  private readonly logger = new Logger(PublicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly lifecycle: ProjectLifecycleService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
    private readonly revisions: EpisodeRevisionService,
  ) {}

  async publish(episodeId: string, dto: PublishEpisodeRequestDto, user: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, user, 'reviewer');
    assertProjectStatus(episode.movie.status, RELEASING_PROJECT, 'publish');
    assertEpisodeStatus(episode.status, RELEASABLE, 'publish');
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (scheduledAt && scheduledAt <= new Date()) {
      throw new BadRequestException('scheduledAt must be in the future; omit it to publish now');
    }
    const missing = await this.missingForRelease(episode);
    if (missing.length) {
      throw new ConflictException({ message: 'The episode cannot be released yet (BR-19)', details: missing });
    }

    await this.prisma.$transaction(async (tx) => {
      const pending = await this.pendingPublication(tx, episodeId);
      const publication = pending
        ? await tx.publication.update({ where: { id: pending.id }, data: { scheduledAt, publishedById: user.id } })
        : await tx.publication.create({
            data: { episodeId, mediaAssetId: episode.approvedMediaAssetId!, scheduledAt, publishedById: user.id },
          });
      if (scheduledAt) {
        await this.moveEpisode(tx, episode, EpisodeStatus.SCHEDULED);
        await this.auditLog.record(
          {
            action: CONTENT_EVENT.EPISODE_SCHEDULED,
            entityType: 'Publication',
            entityId: publication.id,
            movieId: episode.movieId,
            actorId: user.id,
            payload: { episodeId, scheduledAt: scheduledAt.toISOString(), rescheduled: Boolean(pending) },
          },
          tx,
        );
      } else {
        await this.release(tx, publication, user.id);
      }
    });
    return this.list(episodeId, user);
  }

  /**
   * Takes a published episode down, to be fixed (REVISION, BR-56) or for good (REMOVAL, BR-52),
   * or cancels a release that is still scheduled.
   */
  async unpublish(publicationId: string, dto: UnpublishRequestDto, user: AuthenticatedUser) {
    const publication = await this.prisma.publication.findUnique({ where: { id: publicationId } });
    if (!publication) throw new NotFoundException('Publication not found');
    const episode = await this.access.episode(publication.episodeId, user, 'reviewer');
    if (publication.unpublishedAt) throw new ConflictException('This release was already taken down');

    const live = publication.publishedAt !== null;
    assertEpisodeStatus(episode.status, [live ? EpisodeStatus.PUBLISHED : EpisodeStatus.SCHEDULED], 'unpublish');
    if (live && !dto.mode) {
      throw new BadRequestException(
        'Say whether the episode is taken down to be fixed (REVISION) or for good (REMOVAL)',
      );
    }
    const mode = live ? dto.mode! : null;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.publication.updateMany({
        where: { id: publicationId, unpublishedAt: null, publishedAt: live ? { not: null } : null },
        data: {
          unpublishedAt: new Date(),
          unpublishReason: dto.reason,
          unpublishNote: dto.note.trim(),
          unpublishMode: mode,
          unpublishedById: user.id,
        },
      });
      if (count === 0) throw new ConflictException('The release changed meanwhile; reload it');
      if (mode === UnpublishMode.REVISION) {
        await this.revisions.sendBack(tx, publication, user.id, dto.note.trim());
      } else {
        // A cancelled schedule goes back to the checked state; a removed episode can be released again.
        // BR-52 (refunding Members who unlocked a removed episode) hooks in here with MF-2's entitlements.
        await this.moveEpisode(tx, episode, live ? EpisodeStatus.UNPUBLISHED : EpisodeStatus.COMPLIANCE_PASSED);
      }
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.EPISODE_UNPUBLISHED,
          entityType: 'Publication',
          entityId: publicationId,
          movieId: episode.movieId,
          actorId: user.id,
          payload: { episodeId: episode.id, mode, reason: dto.reason, note: dto.note.trim(), cancelledSchedule: !live },
        },
        tx,
      );
    });
    return this.list(episode.id, user);
  }

  /** Every release of an episode, newest first. */
  async list(episodeId: string, user: AuthenticatedUser) {
    await this.access.episode(episodeId, user, 'read');
    return this.prisma.publication.findMany({
      where: { episodeId },
      orderBy: { createdAt: 'desc' },
      include: {
        publishedBy: { select: { id: true, fullName: true } },
        unpublishedBy: { select: { id: true, fullName: true } },
      },
    });
  }

  /** Step 14 for scheduled releases that are due; returns how many went out. */
  async publishDue(now = new Date()): Promise<number> {
    const due = await this.prisma.publication.findMany({
      where: { scheduledAt: { lte: now }, publishedAt: null, unpublishedAt: null },
      orderBy: { scheduledAt: 'asc' },
    });
    let released = 0;
    for (const publication of due) {
      try {
        await this.prisma.$transaction((tx) => this.release(tx, publication, null));
        released += 1;
      } catch (error) {
        this.logger.error(`Scheduled release ${publication.id} failed: ${(error as Error).message}`);
      }
    }
    return released;
  }

  /** What still blocks the release (BR-19, step 12); empty when it can go out. */
  async missingForRelease(episode: EpisodeWithMovie): Promise<string[]> {
    const missing: string[] = [];
    const mediaAssetId = episode.approvedMediaAssetId;
    if (!mediaAssetId) missing.push('an approved media version');
    if (episode.coinPrice === null) missing.push('a Coin price (BR-29)');
    if (!episode.movie.synopsis?.trim()) missing.push('the movie synopsis');
    if (!episode.movie.ageRating) missing.push('the movie age rating (BR-54)');
    if (mediaAssetId) {
      const [label, passed] = await Promise.all([
        this.prisma.aiContentLabel.count({ where: { mediaAssetId } }),
        this.prisma.complianceCheck.count({ where: { mediaAssetId, result: ComplianceResult.PASS } }),
      ]);
      if (!label) missing.push('an AI label (BR-40)');
      if (passed < COMPLIANCE_ITEMS) missing.push('a passed compliance check (BR-42)');
    }
    return missing;
  }

  /** Publishes now: the release goes out, the episode is PUBLISHED, the project may be complete. */
  private async release(tx: PrismaTx, publication: Publication, actorId: string | null): Promise<void> {
    const now = new Date();
    const { count } = await tx.publication.updateMany({
      where: { id: publication.id, publishedAt: null, unpublishedAt: null },
      data: { publishedAt: now },
    });
    if (count === 0) throw new ConflictException('The release changed meanwhile; reload it');
    const episode = await tx.episode.findUniqueOrThrow({
      where: { id: publication.episodeId },
      include: { movie: true },
    });
    // A scheduled release of a project cancelled meanwhile never goes out (BR-39).
    assertProjectStatus(episode.movie.status, RELEASING_PROJECT, 'publish');
    await this.moveEpisode(tx, episode, EpisodeStatus.PUBLISHED);
    if (episode.revisionStartedAt) {
      // The fixed version is out: no longer shown as under maintenance (BR-56).
      await tx.episode.update({ where: { id: episode.id }, data: { revisionStartedAt: null } });
    }
    await this.auditLog.record(
      {
        action: CONTENT_EVENT.EPISODE_PUBLISHED,
        entityType: 'Publication',
        entityId: publication.id,
        movieId: episode.movieId,
        actorId,
        payload: {
          episodeId: episode.id,
          mediaAssetId: publication.mediaAssetId,
          coinPrice: episode.coinPrice,
          afterRevision: episode.revisionStartedAt !== null,
        },
      },
      tx,
    );
    await this.notifications.notify(
      [episode.movie.reviewerId, episode.movie.creatorId],
      {
        type: NOTIFICATION_TYPE.EPISODE_PUBLISHED,
        title: `Episode ${episode.episodeNumber} of "${episode.movie.title}" is now live`,
        link: `/projects/${episode.movieId}/episodes/${episode.id}`,
        payload: { movieId: episode.movieId, episodeId: episode.id, publicationId: publication.id },
      },
      tx,
    );
    await this.lifecycle.completeIfAllPublished(episode.movieId, tx);
  }

  /** The scheduled release of an episode not out yet, if any. */
  private pendingPublication(tx: PrismaTx, episodeId: string) {
    return tx.publication.findFirst({ where: { episodeId, publishedAt: null, unpublishedAt: null } });
  }

  private async moveEpisode(tx: PrismaTx, episode: Episode, status: EpisodeStatus) {
    const { count } = await tx.episode.updateMany({
      where: { id: episode.id, status: episode.status },
      data: { status },
    });
    if (count === 0) throw new ConflictException('The episode changed meanwhile; reload it');
  }
}
