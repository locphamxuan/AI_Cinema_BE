import { ConflictException } from '@nestjs/common';
import {
  ComplianceResult,
  EpisodeStatus,
  LabelType,
  MediaIngestStatus,
  PolicyType,
  ProjectStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { AiLabelService } from './ai-label.service';
import { ContentReviewService } from './content-review.service';

describe('AiLabelService.apply (BR-40)', () => {
  const reviewer = { id: 'reviewer-1' } as AuthenticatedUser;
  const tx = {
    episode: { updateMany: jest.fn() },
    complianceCheck: { updateMany: jest.fn() },
    policy: { findFirst: jest.fn() },
    aiContentLabel: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const prisma = { $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
  const access = { mediaAsset: jest.fn() };
  const reviews = {
    // The real guard, so the version/status rules are exercised, not stubbed.
    assertUnderReview: jest.fn((asset: unknown, allowed: EpisodeStatus[]): void => {
      ContentReviewService.prototype.assertUnderReview.call({}, asset, allowed);
    }),
    sheet: jest.fn(),
  };
  const auditLog = { record: jest.fn() };
  const notifications = { notify: jest.fn() };
  const service = new AiLabelService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    reviews as unknown as ContentReviewService,
    auditLog as unknown as AuditLogService,
    notifications as unknown as NotificationService,
  );

  const asset = (over: { episodeStatus?: EpisodeStatus; projectStatus?: ProjectStatus; approved?: string } = {}) => ({
    id: 'asset-1',
    episodeId: 'ep-1',
    ingestStatus: MediaIngestStatus.READY,
    proposedLabelType: LabelType.AI_GENERATED,
    episode: {
      id: 'ep-1',
      movieId: 'movie-1',
      episodeNumber: 3,
      status: over.episodeStatus ?? EpisodeStatus.APPROVED,
      approvedMediaAssetId: over.approved ?? 'asset-1',
      movie: { title: 'Phim AI' },
      project: { status: over.projectStatus ?? ProjectStatus.IN_PRODUCTION },
    },
  });
  const dto = { labelType: LabelType.AI_EDITED, labelText: '  Phim có chỉnh sửa bằng AI  ' };

  beforeEach(() => {
    jest.clearAllMocks();
    access.mediaAsset.mockResolvedValue(asset());
    tx.episode.updateMany.mockResolvedValue({ count: 1 });
    tx.policy.findFirst.mockResolvedValue({ id: 'policy-1' });
    tx.aiContentLabel.findUnique.mockResolvedValue(null);
    tx.aiContentLabel.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'label-1', ...create }),
    );
    reviews.sheet.mockResolvedValue({ sheet: true });
  });

  it('labels the approved version, resets compliance, audits, notifies and returns the sheet', async () => {
    await expect(service.apply('asset-1', dto, reviewer)).resolves.toEqual({ sheet: true });

    expect(access.mediaAsset).toHaveBeenCalledWith('asset-1', reviewer, 'reviewer');
    expect(tx.episode.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ep-1',
        status: { in: [EpisodeStatus.APPROVED, EpisodeStatus.LABELED, EpisodeStatus.COMPLIANCE_PASSED] },
        approvedMediaAssetId: 'asset-1',
      },
      data: { status: EpisodeStatus.LABELED },
    });
    expect(tx.complianceCheck.updateMany).toHaveBeenCalledWith({
      where: { mediaAssetId: 'asset-1' },
      data: { result: ComplianceResult.PENDING, checkedById: null, checkedAt: null, failureReason: null },
    });
    expect(tx.policy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: PolicyType.AI_LABELING, isActive: true }) }),
    );
    expect(tx.aiContentLabel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mediaAssetId: 'asset-1' },
        create: expect.objectContaining({
          mediaAssetId: 'asset-1',
          labelType: LabelType.AI_EDITED,
          labelText: 'Phim có chỉnh sửa bằng AI',
          displayLocation: 'TOP_RIGHT',
          appliedById: 'reviewer-1',
          policyId: 'policy-1',
        }),
      }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.AI_LABEL_APPLIED,
        entityId: 'label-1',
        projectId: 'movie-1',
        payload: expect.objectContaining({ proposedLabelType: LabelType.AI_GENERATED, previous: null }),
      }),
      tx,
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ type: NOTIFICATION_TYPE.AI_LABEL_APPLIED, link: '/projects/movie-1/episodes/ep-1' }),
      tx,
    );
    expect(reviews.sheet).toHaveBeenCalledWith('asset-1', reviewer);
  });

  it('keeps the chosen display location', async () => {
    await service.apply('asset-1', { ...dto, displayLocation: 'INTRO_NOTICE' }, reviewer);
    expect((tx.aiContentLabel.upsert.mock.calls as [[{ update: unknown }]])[0][0].update).toMatchObject({
      displayLocation: 'INTRO_NOTICE',
    });
  });

  it('relabels after the compliance check and records the previous label', async () => {
    access.mediaAsset.mockResolvedValue(asset({ episodeStatus: EpisodeStatus.COMPLIANCE_PASSED }));
    tx.aiContentLabel.findUnique.mockResolvedValue({ labelType: LabelType.AI_GENERATED, labelText: 'Phim do AI tạo' });

    await service.apply('asset-1', dto, reviewer);

    expect((auditLog.record.mock.calls as [[{ payload: { previous: unknown } }]])[0][0].payload.previous).toEqual({
      labelType: LabelType.AI_GENERATED,
      labelText: 'Phim do AI tạo',
    });
  });

  it('accepts an UNDER_REVISION project (BR-56)', async () => {
    access.mediaAsset.mockResolvedValue(asset({ projectStatus: ProjectStatus.UNDER_REVISION }));
    await expect(service.apply('asset-1', dto, reviewer)).resolves.toEqual({ sheet: true });
  });

  it.each([ProjectStatus.COMPLETED, ProjectStatus.CANCELLED, ProjectStatus.DRAFT])(
    'refuses while the project is %s',
    async (projectStatus) => {
      access.mediaAsset.mockResolvedValue(asset({ projectStatus }));
      await expect(service.apply('asset-1', dto, reviewer)).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([EpisodeStatus.IN_REVIEW, EpisodeStatus.DRAFT])('refuses an episode still %s', async (episodeStatus) => {
    access.mediaAsset.mockResolvedValue(asset({ episodeStatus }));
    await expect(service.apply('asset-1', dto, reviewer)).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a version that is not the approved one', async () => {
    access.mediaAsset.mockResolvedValue(asset({ approved: 'asset-2' }));
    await expect(service.apply('asset-1', dto, reviewer)).rejects.toThrow('not the version under review');
  });

  it('fails with 409 when the episode moved meanwhile, before touching the label', async () => {
    tx.episode.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.apply('asset-1', dto, reviewer)).rejects.toThrow('The episode changed meanwhile');
    expect(tx.aiContentLabel.upsert).not.toHaveBeenCalled();
    expect(reviews.sheet).not.toHaveBeenCalled();
  });

  it('fails when no AI labeling policy is in force', async () => {
    tx.policy.findFirst.mockResolvedValue(null);

    await expect(service.apply('asset-1', dto, reviewer)).rejects.toThrow('No AI_LABELING policy is in force');
    expect(tx.aiContentLabel.upsert).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('propagates an access refusal without opening a transaction', async () => {
    access.mediaAsset.mockRejectedValue(new ConflictException('not yours'));
    await expect(service.apply('asset-1', dto, reviewer)).rejects.toThrow('not yours');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
