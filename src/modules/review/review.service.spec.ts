import { ConflictException } from '@nestjs/common';
import {
  ComplianceCheckType,
  ComplianceResult,
  EpisodePackageStatus,
  ReviewStatus,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ReviewService } from './review.service';

const PASSED_CHECKS = Object.values(ComplianceCheckType).map((checkType) => ({
  checkType,
  result: ComplianceResult.PASS,
  checkedAt: new Date(),
}));

describe('ReviewService', () => {
  const tx = {
    review: { create: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    submission: { update: jest.fn() },
  };
  const prisma = {
    episodePackage: { findUnique: jest.fn() },
    submission: { findFirst: jest.fn(), create: jest.fn() },
    review: { findUnique: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new ReviewService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.episodePackage.findUnique.mockResolvedValue({
      id: 'package-id',
      productionPlanId: 'plan-id',
      status: EpisodePackageStatus.ASSEMBLED,
    });
    prisma.submission.findFirst.mockResolvedValue({ id: 'submission-id', status: SubmissionStatus.SUBMITTED });
    prisma.review.findFirst.mockResolvedValue(null);
    tx.review.create.mockResolvedValue({ id: 'review-id' });
    tx.review.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('createEpisodeSubmission', () => {
    it('hands in the current package once', async () => {
      prisma.submission.findFirst.mockResolvedValue(null);
      await service.createEpisodeSubmission('package-id', {}, 'creator-id');
      expect(prisma.submission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            episodePackageId: 'package-id',
            status: SubmissionStatus.SUBMITTED,
          }) as object,
        }),
      );
    });

    it('refuses a package already waiting for the Reviewer', async () => {
      await expect(service.createEpisodeSubmission('package-id', {}, 'creator-id')).rejects.toThrow('already waiting');
      expect(prisma.submission.create).not.toHaveBeenCalled();
    });

    it('refuses a package replaced by a newer assembly', async () => {
      prisma.episodePackage.findUnique.mockResolvedValue({ id: 'old', status: EpisodePackageStatus.SUPERSEDED });
      await expect(service.createEpisodeSubmission('old', {}, 'creator-id')).rejects.toThrow('current package');
    });
  });

  describe('createReview', () => {
    it('reviews the latest submission and marks it under review', async () => {
      await service.createReview('package-id', { comments: 'Xem lại' }, 'reviewer-id');

      expect(tx.review.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ submissionId: 'submission-id', status: ReviewStatus.PENDING }) as object,
      });
      expect(tx.submission.update).toHaveBeenCalledWith({
        where: { id: 'submission-id' },
        data: { status: SubmissionStatus.UNDER_REVIEW },
      });
    });

    it('does not need compliance, so changes can be requested before labelling', async () => {
      await expect(service.createReview('package-id', {}, 'reviewer-id')).resolves.toEqual({ id: 'review-id' });
    });

    it('returns the review already open on the submission instead of stacking one', async () => {
      prisma.review.findFirst.mockResolvedValue({ id: 'open-review' });
      await expect(service.createReview('package-id', {}, 'reviewer-id')).resolves.toEqual({ id: 'open-review' });
      expect(tx.review.create).not.toHaveBeenCalled();
    });

    it('requires a submitted episode that is still undecided', async () => {
      prisma.submission.findFirst.mockResolvedValue(null);
      await expect(service.createReview('package-id', {}, 'reviewer-id')).rejects.toThrow('submit the episode first');

      prisma.submission.findFirst.mockResolvedValue({ id: 'submission-id', status: SubmissionStatus.APPROVED });
      await expect(service.createReview('package-id', {}, 'reviewer-id')).rejects.toThrow(ConflictException);
    });
  });

  describe('decide', () => {
    const givenReview = (status: ReviewStatus = ReviewStatus.PENDING, complianceChecks: object[] = PASSED_CHECKS) =>
      prisma.review.findUnique.mockResolvedValue({
        id: 'review-id',
        status,
        submissionId: 'submission-id',
        episodePackage: { complianceChecks },
      });

    it.each([
      [ReviewStatus.APPROVED, SubmissionStatus.APPROVED],
      [ReviewStatus.CHANGES_REQUESTED, SubmissionStatus.CHANGES_REQUESTED],
      [ReviewStatus.REJECTED, SubmissionStatus.REJECTED],
    ])('records %s on the review and its submission', async (decision, submissionStatus) => {
      givenReview();
      await service.decide('review-id', { decision, rejectionReason: 'x' });

      expect(tx.review.updateMany).toHaveBeenCalledWith({
        where: { id: 'review-id', status: { in: [ReviewStatus.PENDING, ReviewStatus.IN_REVIEW] } },
        data: expect.objectContaining({ status: decision }) as object,
      });
      expect(tx.submission.update).toHaveBeenCalledWith({
        where: { id: 'submission-id' },
        data: expect.objectContaining({ status: submissionStatus }) as object,
      });
    });

    it('approves only a package that passed every compliance check', async () => {
      givenReview(ReviewStatus.PENDING, PASSED_CHECKS.slice(1));
      await expect(service.decide('review-id', { decision: ReviewStatus.APPROVED })).rejects.toThrow('BR-42');

      givenReview(ReviewStatus.PENDING, []);
      await expect(
        service.decide('review-id', { decision: ReviewStatus.CHANGES_REQUESTED, rejectionReason: 'Sửa cảnh 2' }),
      ).resolves.toBeUndefined();
    });

    it('refuses a review that is already decided', async () => {
      givenReview(ReviewStatus.APPROVED);
      await expect(service.decide('review-id', { decision: ReviewStatus.APPROVED })).rejects.toThrow(
        'already been decided',
      );
    });

    it('leaves the submission alone when another Reviewer decided first', async () => {
      givenReview();
      tx.review.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.decide('review-id', { decision: ReviewStatus.APPROVED })).rejects.toThrow(
        'already been decided',
      );
      expect(tx.submission.update).not.toHaveBeenCalled();
    });

    it('only accepts a final decision', async () => {
      await expect(service.decide('review-id', { decision: ReviewStatus.PENDING })).rejects.toThrow('decision must be');
    });
  });
});
