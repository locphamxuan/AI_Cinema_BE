import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplianceResult, EpisodePackageStatus, ReviewStatus, SubmissionStatus, SubmissionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { complianceVerdict } from 'src/modules/compliance-check/compliance-verdict';
import { CreateEpisodeSubmissionRequestDto } from './dto/create-episode-submission.request.dto';
import { CreateReviewRequestDto } from './dto/create-review.request.dto';
import { DecideReviewRequestDto } from 'src/modules/review/dto/decide-review.request.dto';

const DECIDABLE: ReviewStatus[] = [ReviewStatus.APPROVED, ReviewStatus.CHANGES_REQUESTED, ReviewStatus.REJECTED];
const OPEN_REVIEW: ReviewStatus[] = [ReviewStatus.PENDING, ReviewStatus.IN_REVIEW];
const OPEN_SUBMISSION: SubmissionStatus[] = [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW];

const SUBMISSION_STATUS: Partial<Record<ReviewStatus, SubmissionStatus>> = {
  [ReviewStatus.APPROVED]: SubmissionStatus.APPROVED,
  [ReviewStatus.CHANGES_REQUESTED]: SubmissionStatus.CHANGES_REQUESTED,
  [ReviewStatus.REJECTED]: SubmissionStatus.REJECTED,
};

/**
 * Content review of an assembled episode (MF-1 final review). The Creator hands
 * in the current package; the Reviewer opens one review on that submission and
 * either sends it back or approves it — approval needs every compliance check
 * to have passed first (BR-42).
 */
@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async createEpisodeSubmission(packageId: string, dto: CreateEpisodeSubmissionRequestDto, submittedById: string) {
    const pkg = await this.requirePackage(packageId);
    if (pkg.status !== EpisodePackageStatus.ASSEMBLED) {
      throw new ConflictException('Only the current package of the episode can be submitted');
    }
    const open = await this.prisma.submission.findFirst({
      where: { episodePackageId: packageId, submissionType: SubmissionType.EPISODE, status: { in: OPEN_SUBMISSION } },
    });
    if (open) throw new ConflictException('This package is already waiting for the Reviewer');

    return this.prisma.submission.create({
      data: {
        submissionType: SubmissionType.EPISODE,
        productionPlanId: pkg.productionPlanId,
        episodePackageId: pkg.id,
        status: SubmissionStatus.SUBMITTED,
        note: dto.note,
        submittedById,
        submittedAt: new Date(),
      },
      include: { episodePackage: true },
    });
  }

  /**
   * Opens the review of the package's latest submission. A review already open
   * on it is returned instead, so a Reviewer retrying after a failed decision
   * does not stack reviews.
   */
  async createReview(packageId: string, dto: CreateReviewRequestDto, reviewerId: string) {
    await this.requirePackage(packageId);

    const submission = await this.prisma.submission.findFirst({
      where: {
        episodePackageId: packageId,
        submissionType: SubmissionType.EPISODE,
        ...(dto.submissionId ? { id: dto.submissionId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!submission) {
      throw new BadRequestException('No EPISODE submission exists for this package - submit the episode first');
    }
    if (!OPEN_SUBMISSION.includes(submission.status)) {
      throw new ConflictException(`The submission was already ${submission.status}; the Creator must submit again`);
    }

    const open = await this.prisma.review.findFirst({
      where: { submissionId: submission.id, status: { in: OPEN_REVIEW } },
    });
    if (open) return open;

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          episodePackageId: packageId,
          reviewerId,
          status: ReviewStatus.PENDING,
          comments: dto.comments,
          submissionId: submission.id,
        },
      });
      await tx.submission.update({
        where: { id: submission.id },
        data: { status: SubmissionStatus.UNDER_REVIEW },
      });
      return review;
    });
  }

  async findById(reviewId: string) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        episodePackage: { include: { assets: { include: { generatedAsset: true } } } },
        reviewer: { select: { fullName: true } },
        submission: true,
      },
    });
    if (!review) throw new NotFoundException(`Review with id "${reviewId}" does not exist`);
    return review;
  }

  async decide(reviewId: string, dto: DecideReviewRequestDto) {
    if (!DECIDABLE.includes(dto.decision)) {
      throw new BadRequestException('decision must be APPROVED, CHANGES_REQUESTED or REJECTED');
    }

    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { episodePackage: { include: { complianceChecks: true } } },
    });
    if (!review) throw new NotFoundException(`Review with id "${reviewId}" does not exist`);
    const alreadyDecided = new ConflictException(`Review with id "${reviewId}" has already been decided`);
    if (!OPEN_REVIEW.includes(review.status)) throw alreadyDecided;
    if (
      dto.decision === ReviewStatus.APPROVED &&
      complianceVerdict(review.episodePackage.complianceChecks) !== ComplianceResult.PASS
    ) {
      throw new ConflictException('Every compliance check must PASS before the package is approved (BR-42)');
    }

    return this.prisma.$transaction(async (tx) => {
      const decidedAt = new Date();
      // Conditional on the review still being open: two Reviewers deciding at once
      // can no longer both overwrite it.
      const decided = await tx.review.updateMany({
        where: { id: reviewId, status: { in: OPEN_REVIEW } },
        data: { status: dto.decision, comments: dto.comments, rejectionReason: dto.rejectionReason, decidedAt },
      });
      if (decided.count === 0) throw alreadyDecided;

      if (review.submissionId) {
        await tx.submission.update({
          where: { id: review.submissionId },
          data: { status: SUBMISSION_STATUS[dto.decision], decidedAt },
        });
      }

      return tx.review.findUniqueOrThrow({ where: { id: reviewId } });
    });
  }

  private async requirePackage(packageId: string) {
    const pkg = await this.prisma.episodePackage.findUnique({ where: { id: packageId } });
    if (!pkg) throw new NotFoundException(`Episode package with id "${packageId}" does not exist`);
    return pkg;
  }
}
