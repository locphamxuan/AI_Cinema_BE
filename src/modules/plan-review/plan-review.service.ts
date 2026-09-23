import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PlanReviewStatus,
  Prisma,
  ProductionPlanStatus,
  SceneStatus,
  SubmissionStatus,
  SubmissionType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePlanReviewRequestDto } from './dto/create-plan-review.request.dto';
import { DecidePlanReviewRequestDto } from './dto/decide-plan-review.request.dto';

const DECIDABLE_STATUSES: PlanReviewStatus[] = [
  PlanReviewStatus.APPROVED,
  PlanReviewStatus.CHANGES_REQUESTED,
  PlanReviewStatus.REJECTED,
];
@Injectable()
export class PlanReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async create(planId: string, dto: CreatePlanReviewRequestDto) {
    // const reviewer = await this.prisma.user.findUnique({ where: { id: dto.reviewerId } });
    // if (!reviewer) throw new BadRequestException(`User with id "${dto.reviewerId}" does not exist`);
    // if (reviewer.role !== UserRole.CONTENT_REVIEWER) {
    //   throw new ForbiddenException(`User with id "${dto.reviewerId}" must have role CONTENT_REVIEWER`);
    // }

    const plan = await this.prisma.productionPlan.findUnique({
      where: { id: planId },
      include: { scenes: { select: { id: true } } },
    });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    if (plan.status !== ProductionPlanStatus.SUBMITTED) {
      throw new ConflictException(`Plan must be SUBMITTED to start a review round, current status "${plan.status}"`);
    }

    const sceneIds =
      dto.sceneIds && dto.sceneIds.length > 0 ? [...new Set(dto.sceneIds)] : plan.scenes.map((s) => s.id);
    if (sceneIds.length === 0) {
      throw new BadRequestException('The plan has no scenes to review');
    }

    const planSceneIds = new Set(plan.scenes.map((s) => s.id));
    const unknown = sceneIds.filter((id) => !planSceneIds.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(`Scene ids ${unknown.join(', ')} do not belong to plan "${planId}"`);
    }

    const open = await this.prisma.planReview.findFirst({
      where: {
        productionPlanId: planId,
        sceneId: { in: sceneIds },
        status: { in: [PlanReviewStatus.PENDING, PlanReviewStatus.IN_REVIEW] },
      },
      select: { sceneId: true },
    });
    if (open) {
      throw new ConflictException(`A plan review for scene "${open.sceneId}" is still pending/in review`);
    }

    return this.prisma.$transaction(async (tx) => {
      const reviews = await Promise.all(
        sceneIds.map((sceneId) =>
          tx.planReview.create({
            data: {
              productionPlanId: planId,
              sceneId,
              reviewerId: '1deebe95-e8ca-49aa-bd4d-c44489f9964f',
              status: PlanReviewStatus.PENDING,
              comments: dto.comments,
            },
          }),
        ),
      );

      await tx.productionPlan.update({
        where: { id: planId },
        data: { status: ProductionPlanStatus.UNDER_REVIEW },
      });
      await tx.scene.updateMany({
        where: { productionPlanId: planId },
        data: { status: SceneStatus.UNDER_REVIEW },
      });
      await tx.submission.updateMany({
        where: { productionPlanId: planId, submissionType: SubmissionType.PLAN, status: SubmissionStatus.SUBMITTED },
        data: { status: SubmissionStatus.UNDER_REVIEW },
      });

      return reviews;
    });
  }

  async findById(reviewId: string) {
    const review = await this.prisma.planReview.findUnique({
      where: { id: reviewId },
      include: { productionPlan: true, scene: true, reviewer: { select: { fullName: true } } },
    });
    if (!review) throw new NotFoundException(`Plan review with id "${reviewId}" does not exist`);
    return review;
  }

  async decide(reviewId: string, dto: DecidePlanReviewRequestDto) {
    if (!DECIDABLE_STATUSES.includes(dto.decision)) {
      throw new BadRequestException('decision must be APPROVED, CHANGES_REQUESTED or REJECTED');
    }

    const review = await this.findById(reviewId);
    if (review.status !== PlanReviewStatus.PENDING && review.status !== PlanReviewStatus.IN_REVIEW) {
      throw new ConflictException(`Review with id "${reviewId}" has already been decided`);
    }
    if (
      review.productionPlan.status !== ProductionPlanStatus.SUBMITTED &&
      review.productionPlan.status !== ProductionPlanStatus.UNDER_REVIEW
    ) {
      throw new ConflictException(
        `Cannot decide a review while plan is "${review.productionPlan.status}", expected SUBMITTED or UNDER_REVIEW`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.planReview.update({
        where: { id: reviewId },
        data: {
          status: dto.decision,
          comments: dto.comments,
          rejectionReason: dto.rejectionReason,
          decidedAt: new Date(),
        },
      });

      const state = await this.aggregatePlanState(tx, review.productionPlanId);

      for (const [sceneId, status] of state.sceneStatuses.entries()) {
        await tx.scene.update({ where: { id: sceneId }, data: { status } });
      }

      await tx.productionPlan.update({
        where: { id: review.productionPlanId },
        data: { status: state.planStatus },
      });

      const submissionStatus =
        state.planStatus === ProductionPlanStatus.APPROVED
          ? SubmissionStatus.APPROVED
          : state.planStatus === ProductionPlanStatus.CHANGES_REQUESTED
            ? SubmissionStatus.CHANGES_REQUESTED
            : SubmissionStatus.UNDER_REVIEW;

      await tx.submission.updateMany({
        where: {
          productionPlanId: review.productionPlanId,
          submissionType: SubmissionType.PLAN,
          status: { in: [SubmissionStatus.UNDER_REVIEW, SubmissionStatus.SUBMITTED] },
        },
        data: {
          status: submissionStatus,
          decidedAt: submissionStatus === SubmissionStatus.UNDER_REVIEW ? null : new Date(),
        },
      });

      return updated;
    });
  }

  private async aggregatePlanState(
    tx: Prisma.TransactionClient,
    planId: string,
  ): Promise<{ planStatus: ProductionPlanStatus; sceneStatuses: Map<string, SceneStatus> }> {
    const scenes = await tx.scene.findMany({
      where: { productionPlanId: planId },
      select: { id: true },
      orderBy: { sceneNumber: 'asc' },
    });
    if (scenes.length === 0) {
      return { planStatus: ProductionPlanStatus.UNDER_REVIEW, sceneStatuses: new Map() };
    }

    const reviews = await tx.planReview.findMany({
      where: { productionPlanId: planId },
      orderBy: { createdAt: 'asc' },
    });

    const sceneStatuses = new Map<string, SceneStatus>();
    let changesRequested = false;
    let anyPending = false;

    for (const scene of scenes) {
      const sceneReviews = reviews.filter((r) => r.sceneId === scene.id);
      const decided = sceneReviews.filter((r) => r.decidedAt !== null);
      if (decided.length === 0) {
        sceneStatuses.set(scene.id, SceneStatus.UNDER_REVIEW);
        anyPending = true;
        continue;
      }
      const latest = decided[decided.length - 1];
      if (latest.status === PlanReviewStatus.APPROVED) {
        sceneStatuses.set(scene.id, SceneStatus.APPROVED);
      } else {
        sceneStatuses.set(scene.id, SceneStatus.CHANGES_REQUESTED);
        changesRequested = true;
      }
    }

    let planStatus: ProductionPlanStatus;
    if (changesRequested) {
      planStatus = ProductionPlanStatus.CHANGES_REQUESTED;
    } else if (anyPending) {
      planStatus = ProductionPlanStatus.UNDER_REVIEW;
    } else {
      planStatus = ProductionPlanStatus.APPROVED;
    }

    return { planStatus, sceneStatuses };
  }
}
