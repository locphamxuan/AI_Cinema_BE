import { Injectable } from '@nestjs/common';
import { ProjectStatus, type Publication } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ContentReviewService } from 'src/modules/production/content-review/content-review.service';
import { liftProject, WITH_PROJECT } from 'src/modules/production/project-access/project-relations';

/**
 * BR-56: a published episode taken down to be fixed. It goes back to the Creator with the
 * reason, like a review asking for changes, and stays listed as under maintenance until a fixed
 * version is released. Members who unlocked it keep their access and are not refunded; telling
 * them hooks in here once MF-2 records who unlocked what. A completed movie is UNDER_REVISION
 * meanwhile, and completes again when its last fixed episode is out (ProjectLifecycleService).
 */
@Injectable()
export class EpisodeRevisionService {
  constructor(
    private readonly reviews: ContentReviewService,
    private readonly auditLog: AuditLogService,
  ) {}

  async sendBack(tx: PrismaTx, publication: Publication, reviewerId: string, reason: string): Promise<void> {
    const found = await tx.mediaAsset.findUniqueOrThrow({
      where: { id: publication.mediaAssetId },
      include: { episode: { include: WITH_PROJECT } },
    });
    const asset = { ...found, episode: liftProject(found.episode) };
    await this.reviews.requestChanges(tx, asset, reviewerId, `Taken down to be fixed: ${reason}`);
    await tx.episode.update({ where: { id: asset.episodeId }, data: { revisionStartedAt: new Date() } });

    const projectId = asset.episode.movieId;
    const { count } = await tx.movieProject.updateMany({
      where: { id: projectId, status: ProjectStatus.COMPLETED },
      data: { status: ProjectStatus.UNDER_REVISION },
    });
    if (count) {
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.PROJECT_UNDER_REVISION,
          entityType: 'MovieProject',
          entityId: projectId,
          projectId,
          actorId: reviewerId,
          payload: { episodeId: asset.episodeId, reason },
        },
        tx,
      );
    }
  }
}
