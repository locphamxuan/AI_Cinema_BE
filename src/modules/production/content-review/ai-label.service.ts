import { ConflictException, Injectable } from '@nestjs/common';
import { ComplianceResult, EpisodeStatus, PolicyType } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { activePolicyId } from 'src/modules/platform/policy/active-policy';
import { ContentReviewService, REVIEWED_STATUSES } from './content-review.service';
import type { ApplyAiLabelRequestDto } from './dto/content-review.request.dto';

/**
 * MF-1 step 10 (BR-40): the Reviewer confirms or changes the label the Creator proposed. A
 * version has one label; changing it after the compliance check sends the episode back to
 * LABELED, since that check covers the label.
 */
@Injectable()
export class AiLabelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly reviews: ContentReviewService,
    private readonly auditLog: AuditLogService,
  ) {}

  async apply(mediaAssetId: string, dto: ApplyAiLabelRequestDto, user: AuthenticatedUser) {
    const asset = await this.access.mediaAsset(mediaAssetId, user, 'reviewer');
    assertProjectStatus(asset.episode.movie.status, DELIVERY_PROJECT_STATUSES, 'label media');
    this.reviews.assertUnderReview(asset, REVIEWED_STATUSES);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.episode.updateMany({
        where: { id: asset.episodeId, status: { in: REVIEWED_STATUSES }, approvedMediaAssetId: asset.id },
        data: { status: EpisodeStatus.LABELED },
      });
      if (count === 0) throw new ConflictException('The episode changed meanwhile; reload it');
      // The compliance check judged the previous label; it has to be run again.
      await tx.complianceCheck.updateMany({
        where: { mediaAssetId: asset.id },
        data: { result: ComplianceResult.PENDING, checkedById: null, checkedAt: null, failureReason: null },
      });

      const label = {
        labelType: dto.labelType,
        labelText: dto.labelText.trim(),
        displayLocation: dto.displayLocation ?? 'TOP_RIGHT',
        appliedById: user.id,
        policyId: await activePolicyId(tx, PolicyType.AI_LABELING),
        appliedAt: new Date(),
      };
      const previous = await tx.aiContentLabel.findUnique({ where: { mediaAssetId: asset.id } });
      const saved = await tx.aiContentLabel.upsert({
        where: { mediaAssetId: asset.id },
        create: { mediaAssetId: asset.id, ...label },
        update: label,
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.AI_LABEL_APPLIED,
          entityType: 'AiContentLabel',
          entityId: saved.id,
          movieId: asset.episode.movieId,
          actorId: user.id,
          payload: {
            episodeId: asset.episodeId,
            mediaAssetId: asset.id,
            proposedLabelType: asset.proposedLabelType,
            labelType: saved.labelType,
            labelText: saved.labelText,
            previous: previous ? { labelType: previous.labelType, labelText: previous.labelText } : null,
          },
        },
        tx,
      );
    });
    return this.reviews.sheet(mediaAssetId, user);
  }
}
