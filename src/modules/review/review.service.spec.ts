import { ConflictException } from '@nestjs/common';
import { ReviewStatus, SubmissionStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ReviewService } from './review.service';

describe('ReviewService', () => {
  const tx = {
    review: { create: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    submission: { update: jest.fn() },
  };
  const prisma = {
    episodePackage: { findUnique: jest.fn() },
    complianceCheck: { findFirst: jest.fn() },
    submission: { findFirst: jest.fn() },
    review: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new ReviewService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.episodePackage.findUnique.mockResolvedValue({ id: 'package-id', productionPlanId: 'plan-id' });
    prisma.complianceCheck.findFirst.mockResolvedValue({ id: 'label-pass' });
    prisma.submission.findFirst.mockResolvedValue({ id: 'submission-id' });
    tx.review.create.mockResolvedValue({ id: 'review-id' });
    tx.review.updateMany.mockResolvedValue({ count: 1 });
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

    it('requires the AI label check to have passed first', async () => {
      prisma.complianceCheck.findFirst.mockResolvedValue(null);
      await expect(service.createReview('package-id', {}, 'reviewer-id')).rejects.toThrow(ConflictException);
    });

    it('requires a submitted episode', async () => {
      prisma.submission.findFirst.mockResolvedValue(null);
      await expect(service.createReview('package-id', {}, 'reviewer-id')).rejects.toThrow('submit the episode first');
    });
  });

  describe('decide', () => {
    const givenReview = (status: ReviewStatus = ReviewStatus.PENDING) =>
      prisma.review.findUnique.mockResolvedValue({ id: 'review-id', status, submissionId: 'submission-id' });

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
