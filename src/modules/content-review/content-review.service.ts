import { ConflictException, Injectable } from '@nestjs/common';
import {
  ContentReviewDecision,
  EpisodeStatus,
  MediaIngestStatus,
  type Episode,
  type MediaAsset,
  type Movie,
} from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/audit-log/content-events';
import { NotificationService } from 'src/modules/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/notification/notification-types';
import { ProjectAccessService } from 'src/modules/project-access/project-access.service';
import {
  assertEpisodeStatus,
  assertProjectStatus,
  DELIVERY_PROJECT_STATUSES,
} from 'src/modules/project-access/project-rules';
import type { ReviewMediaRequestDto } from './dto/content-review.request.dto';

/** Until it is scheduled, a reviewed episode can still be sent back to the studio. */
export const REVIEWED_STATUSES: EpisodeStatus[] = [
  EpisodeStatus.APPROVED,
  EpisodeStatus.LABELED,
  EpisodeStatus.COMPLIANCE_PASSED,
];

/** BR-31: an actual length this far from the target is flagged on the review sheet. */
const DURATION_WARNING_RATIO = 0.2;

export type ReviewedAsset = MediaAsset & { episode: Episode & { movie: Movie } };

/** MF-1 steps 8–9: the Reviewer approves a delivered version or asks the studio for changes (BR-16, BR-18). */
@Injectable()
export class ContentReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  async review(mediaAssetId: string, dto: ReviewMediaRequestDto, user: AuthenticatedUser) {
    const asset = await this.access.mediaAsset(mediaAssetId, user, 'reviewer');
    assertProjectStatus(asset.episode.movie.status, DELIVERY_PROJECT_STATUSES, 'review media');

    if (dto.decision === ContentReviewDecision.CHANGES_REQUESTED) {
      this.assertUnderReview(asset, [EpisodeStatus.IN_REVIEW, ...REVIEWED_STATUSES]);
      await this.prisma.$transaction((tx) => this.requestChanges(tx, asset, user.id, dto.comments!.trim()));
    } else {
      this.assertUnderReview(asset, [EpisodeStatus.IN_REVIEW]);
      await this.prisma.$transaction((tx) => this.approve(tx, asset, user.id, dto.comments?.trim() || null));
    }
    return this.sheet(mediaAssetId, user);
  }

  /**
   * Sends the version back: the episode waits for a new delivery and loses its approved version,
   * so a later delivery is reviewed, labeled and checked again (BR-18). Also used by a failed
   * compliance check (BR-42) and by a published episode taken down to be fixed (BR-56).
   */
  async requestChanges(tx: PrismaTx, asset: ReviewedAsset, reviewerId: string, comments: string): Promise<void> {
    const { episode } = asset;
    const { count } = await tx.episode.updateMany({
      where: {
        id: episode.id,
        OR: [
          { status: EpisodeStatus.IN_REVIEW },
          { status: { in: [...REVIEWED_STATUSES, EpisodeStatus.PUBLISHED] }, approvedMediaAssetId: asset.id },
        ],
      },
      data: { status: EpisodeStatus.CHANGES_REQUESTED, approvedMediaAssetId: null },
    });
    if (count === 0) throw new ConflictException('The episode changed meanwhile; reload it');
    const review = await tx.contentReview.create({
      data: { mediaAssetId: asset.id, reviewerId, decision: ContentReviewDecision.CHANGES_REQUESTED, comments },
    });
    await this.auditLog.record(
      {
        action: CONTENT_EVENT.CONTENT_CHANGES_REQUESTED,
        entityType: 'ContentReview',
        entityId: review.id,
        movieId: episode.movieId,
        actorId: reviewerId,
        payload: { episodeId: episode.id, mediaAssetId: asset.id, version: asset.version, comments },
      },
      tx,
    );
    await this.notifications.notify(
      [episode.movie.creatorId],
      {
        type: NOTIFICATION_TYPE.CONTENT_CHANGES_REQUESTED,
        title: `Changes requested on episode ${episode.episodeNumber} of "${episode.movie.title}"`,
        body: `Forward this to the studio and deliver a new version: ${comments}`,
        link: `/projects/${episode.movieId}/episodes/${episode.id}`,
        payload: { movieId: episode.movieId, episodeId: episode.id, mediaAssetId: asset.id },
      },
      tx,
    );
  }

  /** Everything the Reviewer looks at for one version: disclosure, length, history, label, compliance. */
  async sheet(mediaAssetId: string, user: AuthenticatedUser) {
    await this.access.mediaAsset(mediaAssetId, user, 'read');
    const asset = await this.prisma.mediaAsset.findUniqueOrThrow({
      where: { id: mediaAssetId },
      include: {
        episode: { include: { movie: { select: { id: true, title: true, status: true } } } },
        submittedBy: { select: { id: true, fullName: true } },
        contentReviews: {
          orderBy: { createdAt: 'desc' },
          include: { reviewer: { select: { id: true, fullName: true } } },
        },
        aiContentLabel: { include: { policy: { select: { id: true, name: true, documentReference: true } } } },
        complianceChecks: {
          orderBy: { checkType: 'asc' },
          include: { policy: { select: { id: true, name: true, documentReference: true } } },
        },
      },
    });
    const { episode, ...rest } = asset;
    return {
      ...rest,
      episode: {
        id: episode.id,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        status: episode.status,
        targetDurationSeconds: episode.targetDurationSeconds,
        movie: episode.movie,
      },
      isApprovedVersion: episode.approvedMediaAssetId === asset.id,
      durationCheck: durationCheck(episode.targetDurationSeconds, asset.durationSeconds),
    };
  }

  /** Throws unless `asset` is the version the episode is being reviewed with, in one of `allowed`. */
  assertUnderReview(asset: ReviewedAsset, allowed: EpisodeStatus[]): void {
    const { episode } = asset;
    assertEpisodeStatus(episode.status, allowed, 'review this version');
    const current =
      episode.status === EpisodeStatus.IN_REVIEW
        ? asset.ingestStatus === MediaIngestStatus.READY
        : episode.approvedMediaAssetId === asset.id;
    if (!current) throw new ConflictException('This is not the version under review; open the latest one');
  }

  private async approve(tx: PrismaTx, asset: ReviewedAsset, reviewerId: string, comments: string | null) {
    const { episode } = asset;
    const { count } = await tx.episode.updateMany({
      where: { id: episode.id, status: EpisodeStatus.IN_REVIEW },
      data: { status: EpisodeStatus.APPROVED, approvedMediaAssetId: asset.id },
    });
    if (count === 0) throw new ConflictException('The episode changed meanwhile; reload it');
    const review = await tx.contentReview.create({
      data: { mediaAssetId: asset.id, reviewerId, decision: ContentReviewDecision.APPROVED, comments },
    });
    await this.auditLog.record(
      {
        action: CONTENT_EVENT.CONTENT_APPROVED,
        entityType: 'ContentReview',
        entityId: review.id,
        movieId: episode.movieId,
        actorId: reviewerId,
        payload: { episodeId: episode.id, mediaAssetId: asset.id, version: asset.version },
      },
      tx,
    );
    await this.notifications.notify(
      [episode.movie.creatorId],
      {
        type: NOTIFICATION_TYPE.CONTENT_APPROVED,
        title: `Episode ${episode.episodeNumber} of "${episode.movie.title}" was approved`,
        body: `Version ${asset.version} goes on to labeling and the compliance check.`,
        link: `/projects/${episode.movieId}/episodes/${episode.id}`,
        payload: { movieId: episode.movieId, episodeId: episode.id, mediaAssetId: asset.id },
      },
      tx,
    );
  }
}

/** BR-31: no limit on length, only a warning when the delivery strays far from the target. */
export function durationCheck(targetSeconds: number, actualSeconds: number | null) {
  if (actualSeconds === null) return { targetSeconds, actualSeconds, deviationSeconds: null, warning: false };
  const deviationSeconds = actualSeconds - targetSeconds;
  return {
    targetSeconds,
    actualSeconds,
    deviationSeconds,
    warning: Math.abs(deviationSeconds) > targetSeconds * DURATION_WARNING_RATIO,
  };
}
