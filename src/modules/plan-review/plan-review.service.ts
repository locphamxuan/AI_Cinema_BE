import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PlanReview,
  PlanReviewField,
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

// BR-39: besides every scene, a round reviews these plan-level fields.
const PLAN_FIELDS: PlanReviewField[] = [
  PlanReviewField.OVERALL_SCRIPT,
  PlanReviewField.DURATION,
  PlanReviewField.TOKEN_ESTIMATE,
];
@Injectable()
export class PlanReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async create(planId: string, dto: CreatePlanReviewRequestDto, reviewerId: string) {
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
      where: { productionPlanId: planId, status: { in: [PlanReviewStatus.PENDING, PlanReviewStatus.IN_REVIEW] } },
      select: { id: true },
    });
    if (open) {
      throw new ConflictException('A plan review round is still pending/in review');
    }

    const targets: { field: PlanReviewField; sceneId: string | null }[] = [
      ...sceneIds.map((sceneId) => ({ field: PlanReviewField.SCENE, sceneId })),
      ...PLAN_FIELDS.map((field) => ({ field, sceneId: null })),
    ];

    return this.prisma.$transaction(async (tx) => {
      // One statement at a time: a transaction runs on a single connection.
      const reviews: PlanReview[] = [];
      for (const { field, sceneId } of targets) {
        reviews.push(
          await tx.planReview.create({
            data: {
              productionPlanId: planId,
              field,
              sceneId,
              reviewerId,
              status: PlanReviewStatus.PENDING,
              comments: dto.comments,
            },
          }),
        );
      }

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
      // Conditional on the row still being open, so two Reviewers deciding the
      // same target at once cannot both record a verdict.
      const decided = await tx.planReview.updateMany({
        where: { id: reviewId, status: { in: [PlanReviewStatus.PENDING, PlanReviewStatus.IN_REVIEW] } },
        data: {
          status: dto.decision,
          comments: dto.comments,
          rejectionReason: dto.rejectionReason,
          decidedAt: new Date(),
        },
      });
      if (decided.count === 0) throw new ConflictException(`Review with id "${reviewId}" has already been decided`);

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

      return tx.planReview.findUniqueOrThrow({ where: { id: reviewId } });
    });
  }

  /**
   * The latest review of every target (each scene, each plan field) decides the
   * plan: the round stays UNDER_REVIEW until all are decided, then any change
   * request sends the plan back to the Creator, otherwise it is APPROVED.
   */
  private async aggregatePlanState(
    tx: Prisma.TransactionClient,
    planId: string,
  ): Promise<{ planStatus: ProductionPlanStatus; sceneStatuses: Map<string, SceneStatus> }> {
    const reviews = await tx.planReview.findMany({
      where: { productionPlanId: planId },
      orderBy: { createdAt: 'asc' },
    });

    const latestByTarget = new Map<string, (typeof reviews)[number]>();
    for (const review of reviews) {
      latestByTarget.set(review.field === PlanReviewField.SCENE ? `scene:${review.sceneId}` : review.field, review);
    }

    const sceneStatuses = new Map<string, SceneStatus>();
    let changesRequested = false;
    let anyPending = latestByTarget.size === 0;

    for (const review of latestByTarget.values()) {
      const decided = review.decidedAt !== null;
      const approved = review.status === PlanReviewStatus.APPROVED;
      if (!decided) anyPending = true;
      else if (!approved) changesRequested = true;

      if (review.field === PlanReviewField.SCENE && review.sceneId) {
        sceneStatuses.set(
          review.sceneId,
          !decided ? SceneStatus.UNDER_REVIEW : approved ? SceneStatus.APPROVED : SceneStatus.CHANGES_REQUESTED,
        );
      }
    }

    const planStatus = anyPending
      ? ProductionPlanStatus.UNDER_REVIEW
      : changesRequested
        ? ProductionPlanStatus.CHANGES_REQUESTED
        : ProductionPlanStatus.APPROVED;

    return { planStatus, sceneStatuses };
  }
}
