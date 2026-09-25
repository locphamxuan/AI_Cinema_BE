import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AssetType,
  GeneratedAssetStatus,
  GenerationJobStatus,
  ProductionPlanStatus,
  SceneStatus,
  SubmissionStatus,
  SubmissionType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateSceneRequestDto } from './dto/create-scene.request.dto';
import { UpdateSceneRequestDto } from './dto/update-scene.request.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene.request.dto';
import { latestAttempts } from 'src/modules/generation-job/latest-attempts';
import { assertProjectOpen } from 'src/modules/production-project/project-lifecycle';
import { UpdateSceneDirectionRequestDto } from './dto/update-scene-direction.request.dto';
import { assertCutOpen } from './cut-lock';

@Injectable()
export class SceneService {
  constructor(private readonly prisma: PrismaService) {}

  async create(planId: string, dto: CreateSceneRequestDto) {
    const plan = await this.requireEditablePlan(planId);

    const duplicate = await this.prisma.scene.findUnique({
      where: { productionPlanId_sceneNumber: { productionPlanId: planId, sceneNumber: dto.sceneNumber } },
    });
    if (duplicate) {
      throw new ConflictException(`Scene number ${dto.sceneNumber} already exists in plan "${planId}"`);
    }

    const project = await this.prisma.productionProject.findUnique({ where: { id: plan.productionProjectId } });
    if (!project) throw new NotFoundException('Production project does not exist');

    this.assertDurationAllowed(project, plan.targetDurationSeconds, plan.durationTotal + dto.targetDurationSeconds);

    return this.prisma.$transaction(async (tx) => {
      const scene = await tx.scene.create({
        data: {
          productionPlanId: planId,
          sceneNumber: dto.sceneNumber,
          title: dto.title,
          scriptText: dto.scriptText,
          description: dto.description,
          targetDurationSeconds: dto.targetDurationSeconds,
          estimatedTokens: dto.estimatedTokens,
        },
      });
      await tx.productionPlan.update({
        where: { id: planId },
        data: { totalSceneCount: { increment: 1 } },
      });
      return scene;
    });
  }

  async update(sceneId: string, dto: UpdateSceneRequestDto) {
    const scene = await this.findById(sceneId);
    const plan = await this.requireEditablePlan(scene.productionPlanId);

    if (dto.sceneNumber !== undefined && dto.sceneNumber !== scene.sceneNumber) {
      const duplicate = await this.prisma.scene.findUnique({
        where: {
          productionPlanId_sceneNumber: { productionPlanId: scene.productionPlanId, sceneNumber: dto.sceneNumber },
        },
      });
      if (duplicate) {
        throw new ConflictException(`Scene number ${dto.sceneNumber} already exists in this plan`);
      }
    }

    if (dto.targetDurationSeconds !== undefined && dto.targetDurationSeconds !== scene.targetDurationSeconds) {
      const project = await this.prisma.productionProject.findUnique({
        where: { id: plan.productionProjectId },
      });
      if (!project) throw new NotFoundException('Production project does not exist');

      const otherTotal = plan.durationTotal - scene.targetDurationSeconds;
      this.assertDurationAllowed(project, plan.targetDurationSeconds, otherTotal + dto.targetDurationSeconds);
    }

    return this.prisma.scene.update({ where: { id: sceneId }, data: dto });
  }

  async remove(sceneId: string) {
    const scene = await this.findById(sceneId);
    const plan = await this.requireEditablePlan(scene.productionPlanId);

    const job = await this.prisma.generationJob.findFirst({ where: { sceneId } });
    if (job) {
      throw new ConflictException('Cannot delete a scene that already has generation jobs');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.scene.delete({ where: { id: sceneId } });
      await tx.productionPlan.update({
        where: { id: plan.id },
        data: { totalSceneCount: { decrement: 1 } },
      });
      return { id: sceneId, deleted: true };
    });
  }

  async submit(sceneId: string, dto: SubmitSceneRequestDto, submittedById: string) {
    const scene = await this.findById(sceneId);

    const plan = await this.prisma.productionPlan.findUnique({ where: { id: scene.productionPlanId } });
    if (!plan) throw new NotFoundException('Production plan does not exist');
    if (plan.status !== ProductionPlanStatus.APPROVED) {
      throw new ConflictException('Scene can only be submitted after its production plan is APPROVED');
    }
    if (scene.status !== SceneStatus.GENERATING && scene.status !== SceneStatus.SUBMITTED) {
      throw new ConflictException(`Scene must be GENERATING before submission, current status "${scene.status}"`);
    }

    const jobs = await this.prisma.generationJob.findMany({
      where: { sceneId, productionPlanId: scene.productionPlanId },
      include: { generatedAssets: true },
    });
    if (jobs.length === 0) {
      throw new BadRequestException('Scene has no generation jobs yet');
    }
    // A cancelled job was removed from the scene by the Creator; its output no longer counts.
    const current = latestAttempts(jobs).filter((job) => job.status !== GenerationJobStatus.CANCELLED);
    const hasPendingJob = current.some((job) => !['COMPLETED', 'FAILED'].includes(job.status));
    if (hasPendingJob) {
      throw new ConflictException('Scene still has running/pending generation jobs');
    }
    const hasVideo = current.some((job) =>
      job.generatedAssets.some(
        (asset) => asset.assetType === AssetType.VIDEO && asset.status !== GeneratedAssetStatus.VALIDATION_FAILED,
      ),
    );
    if (!hasVideo) {
      throw new BadRequestException('Scene must have at least one VIDEO asset to be submitted');
    }
    if (current.some((job) => job.status === 'FAILED')) {
      throw new BadRequestException('Scene has a FAILED generation job; retry or regenerate before submitting');
    }

    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.submission.create({
        data: {
          submissionType: SubmissionType.SCENE,
          productionPlanId: scene.productionPlanId,
          sceneId,
          status: SubmissionStatus.APPROVED,
          note: dto.note,
          submittedById,
          submittedAt: new Date(),
          decidedAt: new Date(),
        },
      });

      await tx.scene.update({ where: { id: sceneId }, data: { status: SceneStatus.COMPLETED } });
      await tx.productionPlan.update({
        where: { id: scene.productionPlanId },
        data: { completedSceneCount: { increment: 1 } },
      });

      return submission;
    });
  }

  /**
   * During production the approved script and duration stay fixed, but the Creator can
   * still retitle a scene and refine its description, which steers its next generations.
   */
  async updateDirection(sceneId: string, dto: UpdateSceneDirectionRequestDto) {
    const scene = await this.findById(sceneId);
    await this.requireProductionPlan(scene.productionPlanId);
    return this.prisma.scene.update({
      where: { id: sceneId },
      data: { title: dto.title?.trim(), description: dto.description },
    });
  }

  /**
   * Starts a scene over: every generation of it is cancelled (kept for audit, tokens are
   * not refunded) and a finished scene goes back to APPROVED, ready to be generated again.
   */
  async reset(sceneId: string) {
    const scene = await this.findById(sceneId);
    await this.requireProductionPlan(scene.productionPlanId);

    const jobs = await this.prisma.generationJob.findMany({
      where: { sceneId, status: { not: GenerationJobStatus.CANCELLED } },
      select: { id: true, status: true },
    });
    if (jobs.some((job) => job.status === GenerationJobStatus.RUNNING)) {
      throw new ConflictException('A generation of this scene is still running');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.generationJob.updateMany({
        where: { id: { in: jobs.map((job) => job.id) } },
        data: { status: GenerationJobStatus.CANCELLED },
      });
      if (scene.status === SceneStatus.COMPLETED) {
        await tx.productionPlan.updateMany({
          where: { id: scene.productionPlanId, completedSceneCount: { gt: 0 } },
          data: { completedSceneCount: { decrement: 1 } },
        });
      }
      return tx.scene.update({ where: { id: sceneId }, data: { status: SceneStatus.APPROVED } });
    });
  }

  async findById(sceneId: string) {
    const scene = await this.prisma.scene.findUnique({
      where: { id: sceneId },
      include: { productionPlan: { select: { productionProjectId: true } } },
    });
    if (!scene) {
      throw new NotFoundException(`Scene with id "${sceneId}" does not exist`);
    }
    return scene;
  }

  /** A plan in production: approved, its project open and its cut not with the Reviewer. */
  private async requireProductionPlan(planId: string) {
    const plan = await this.prisma.productionPlan.findUnique({
      where: { id: planId },
      include: { productionProject: { select: { status: true } } },
    });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    if (plan.status !== ProductionPlanStatus.APPROVED) {
      throw new ConflictException('A scene can only be reworked in the Studio once its plan is APPROVED');
    }
    assertProjectOpen(plan.productionProject);
    await assertCutOpen(this.prisma, planId);
    return plan;
  }

  private async requireEditablePlan(planId: string) {
    const plan = await this.prisma.productionPlan.findUnique({
      where: { id: planId },
      include: { scenes: { select: { targetDurationSeconds: true } } },
    });
    if (!plan) {
      throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    }
    if (plan.status !== ProductionPlanStatus.DRAFT && plan.status !== ProductionPlanStatus.CHANGES_REQUESTED) {
      throw new ConflictException(
        `Scenes can only be modified while the plan is DRAFT or CHANGES_REQUESTED, current status "${plan.status}"`,
      );
    }
    const durationTotal = plan.scenes.reduce((sum, scene) => sum + scene.targetDurationSeconds, 0);
    return { ...plan, durationTotal };
  }

  private assertDurationAllowed(
    project: { defaultEpisodeDurationSeconds: number | null },
    planTargetDuration: number | null,
    total: number,
  ) {
    if (planTargetDuration !== null && planTargetDuration !== undefined && total > planTargetDuration) {
      throw new BadRequestException(
        `Total scene duration (${total}s) exceeds the plan target duration (${planTargetDuration}s)`,
      );
    }
    if (
      project.defaultEpisodeDurationSeconds !== null &&
      project.defaultEpisodeDurationSeconds !== undefined &&
      total > project.defaultEpisodeDurationSeconds
    ) {
      throw new BadRequestException(
        `Total scene duration (${total}s) exceeds the project episode duration limit (${project.defaultEpisodeDurationSeconds}s)`,
      );
    }
  }
}
