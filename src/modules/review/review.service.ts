import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplianceCheckType, ComplianceResult, ReviewStatus, SubmissionStatus, SubmissionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateEpisodeSubmissionRequestDto } from './dto/create-episode-submission.request.dto';
import { CreateReviewRequestDto } from './dto/create-review.request.dto';
import { DecideReviewRequestDto } from 'src/modules/review/dto/decide-review.request.dto';

const DECIDABLE: ReviewStatus[] = [ReviewStatus.APPROVED, ReviewStatus.CHANGES_REQUESTED, ReviewStatus.REJECTED];
const OPEN: ReviewStatus[] = [ReviewStatus.PENDING, ReviewStatus.IN_REVIEW];

const SUBMISSION_STATUS: Partial<Record<ReviewStatus, SubmissionStatus>> = {
  [ReviewStatus.APPROVED]: SubmissionStatus.APPROVED,
  [ReviewStatus.CHANGES_REQUESTED]: SubmissionStatus.CHANGES_REQUESTED,
  [ReviewStatus.REJECTED]: SubmissionStatus.REJECTED,
};

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async createEpisodeSubmission(packageId: string, dto: CreateEpisodeSubmissionRequestDto, submittedById: string) {
    const pkg = await this.requirePackage(packageId);

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

  async createReview(packageId: string, dto: CreateReviewRequestDto, reviewerId: string) {
    await this.requirePackage(packageId);

    const labelPass = await this.prisma.complianceCheck.findFirst({
      where: {
        episodePackageId: packageId,
        checkType: ComplianceCheckType.AI_LABEL_PRESENCE,
        result: ComplianceResult.PASS,
      },
    });
    if (!labelPass) {
      throw new ConflictException(
        'The package must have an AI_LABEL_PRESENCE compliance check with result PASS before final review',
      );
    }

    let submissionId = dto.submissionId;
    if (!submissionId) {
      const latest = await this.prisma.submission.findFirst({
        where: { episodePackageId: packageId, submissionType: SubmissionType.EPISODE },
        orderBy: { createdAt: 'desc' },
      });
      submissionId = latest?.id;
    }
    if (!submissionId) {
      throw new BadRequestException('No EPISODE submission exists for this package - submit the episode first');
    }

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          episodePackageId: packageId,
          reviewerId,
          status: ReviewStatus.PENDING,
          comments: dto.comments,
          submissionId,
        },
      });
      await tx.submission.update({
        where: { id: submissionId },
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

    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException(`Review with id "${reviewId}" does not exist`);
    const alreadyDecided = new ConflictException(`Review with id "${reviewId}" has already been decided`);
    if (!OPEN.includes(review.status)) throw alreadyDecided;

    return this.prisma.$transaction(async (tx) => {
      const decidedAt = new Date();
      // Conditional on the review still being open: two Reviewers deciding at once
      // can no longer both overwrite it.
      const decided = await tx.review.updateMany({
        where: { id: reviewId, status: { in: OPEN } },
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
