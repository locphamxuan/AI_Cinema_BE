import { ConflictException, Injectable } from '@nestjs/common';
import { ComplianceCheckType, ComplianceResult, EpisodeStatus, PolicyType } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { activePolicyId } from 'src/modules/platform/policy/active-policy';
import { ContentReviewService, type ReviewedAsset } from './content-review.service';
import type { RunComplianceRequestDto } from './dto/content-review.request.dto';

interface Verdict {
  checkType: ComplianceCheckType;
  result: 'PASS' | 'FAIL';
  failureReason: string | null;
  policyType: PolicyType;
}

const ITEM_NAMES: Record<ComplianceCheckType, string> = {
  AI_LABEL_PRESENCE: 'AI label (Article 44)',
  DECREE_142_NOTICE: 'Decree 142 notice',
  CONTENT_SAFETY: 'Content safety',
  REAL_PERSON_LIKENESS: 'Real person or event',
};

/** The four BR-42 items. The label item is the system's; the real-person item needs both sides. */
export function complianceVerdicts(
  asset: Pick<ReviewedAsset, 'aiDisclosure'> & { label: { labelText: string } | null },
  dto: RunComplianceRequestDto,
): Verdict[] {
  const disclosure = asset.aiDisclosure as { noRealPersonLikeness?: boolean } | null;
  const studioCommitted = disclosure?.noRealPersonLikeness === true;
  const labelled = Boolean(asset.label?.labelText.trim());
  const fromReviewer = (item: RunComplianceRequestDto['contentSafety']) => ({
    result: item.result,
    failureReason: item.result === ComplianceResult.FAIL ? item.failureReason!.trim() : null,
  });

  return [
    {
      checkType: ComplianceCheckType.AI_LABEL_PRESENCE,
      result: labelled ? 'PASS' : 'FAIL',
      failureReason: labelled ? null : 'The version has no AI label',
      policyType: PolicyType.AI_LABELING,
    },
    {
      checkType: ComplianceCheckType.DECREE_142_NOTICE,
      ...fromReviewer(dto.decree142Notice),
      policyType: PolicyType.LEGAL,
    },
    {
      checkType: ComplianceCheckType.CONTENT_SAFETY,
      ...fromReviewer(dto.contentSafety),
      policyType: PolicyType.CONTENT_POLICY,
    },
    {
      checkType: ComplianceCheckType.REAL_PERSON_LIKENESS,
      result: studioCommitted && !dto.depictsRealPersonOrEvent ? 'PASS' : 'FAIL',
      failureReason: !studioCommitted
        ? 'The studio did not commit to no real-person likeness in the AI Disclosure'
        : dto.depictsRealPersonOrEvent
          ? dto.realPersonNote!.trim()
          : null,
      policyType: PolicyType.LEGAL,
    },
  ];
}

/**
 * MF-1 step 11 (BR-42): all four items PASS → COMPLIANCE_PASSED, ready to be priced and
 * scheduled; any FAIL → the version goes back to the studio like a review asking for changes.
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly reviews: ContentReviewService,
    private readonly auditLog: AuditLogService,
  ) {}

  async run(mediaAssetId: string, dto: RunComplianceRequestDto, user: AuthenticatedUser) {
    const asset = await this.access.mediaAsset(mediaAssetId, user, 'reviewer');
    assertProjectStatus(asset.episode.movie.status, DELIVERY_PROJECT_STATUSES, 'check compliance');
    this.reviews.assertUnderReview(asset, [EpisodeStatus.LABELED]);

    await this.prisma.$transaction(async (tx) => {
      const label = await tx.aiContentLabel.findUnique({ where: { mediaAssetId: asset.id } });
      const verdicts = complianceVerdicts({ aiDisclosure: asset.aiDisclosure, label }, dto);
      await this.record(tx, asset.id, verdicts, user.id);
      const failed = verdicts.filter((v) => v.result === ComplianceResult.FAIL);

      await this.auditLog.record(
        {
          action: failed.length ? CONTENT_EVENT.COMPLIANCE_FAILED : CONTENT_EVENT.COMPLIANCE_PASSED,
          entityType: 'MediaAsset',
          entityId: asset.id,
          movieId: asset.episode.movieId,
          actorId: user.id,
          payload: {
            episodeId: asset.episodeId,
            results: Object.fromEntries(verdicts.map((v) => [v.checkType, v.result])),
            depictsRealPersonOrEvent: dto.depictsRealPersonOrEvent,
          },
        },
        tx,
      );
      if (failed.length) {
        const summary = failed.map((v) => `${ITEM_NAMES[v.checkType]}: ${v.failureReason}`).join('; ');
        await this.reviews.requestChanges(tx, asset, user.id, `Compliance check failed. ${summary}`);
        return;
      }
      const { count } = await tx.episode.updateMany({
        where: { id: asset.episodeId, status: EpisodeStatus.LABELED, approvedMediaAssetId: asset.id },
        data: { status: EpisodeStatus.COMPLIANCE_PASSED },
      });
      if (count === 0) throw new ConflictException('The episode changed meanwhile; reload it');
    });
    return this.reviews.sheet(mediaAssetId, user);
  }

  private async record(tx: PrismaTx, mediaAssetId: string, verdicts: Verdict[], reviewerId: string) {
    const checkedAt = new Date();
    for (const { checkType, result, failureReason, policyType } of verdicts) {
      const data = {
        result,
        failureReason,
        checkedById: reviewerId,
        checkedAt,
        policyId: await activePolicyId(tx, policyType),
      };
      await tx.complianceCheck.upsert({
        where: { mediaAssetId_checkType: { mediaAssetId, checkType } },
        create: { mediaAssetId, checkType, ...data },
        update: data,
      });
    }
  }
}
