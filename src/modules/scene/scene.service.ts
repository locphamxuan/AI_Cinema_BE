import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetType,
  GeneratedAssetStatus,
  ProductionPlanStatus,
  SceneStatus,
  SubmissionStatus,
  SubmissionType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateSceneRequestDto } from './dto/create-scene.request.dto';
import { UpdateSceneRequestDto } from './dto/update-scene.request.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene.request.dto';

@Injectable()
export class SceneService {
  constructor(private readonly prisma: PrismaService) {}

  async create(planId: string, dto: CreateSceneRequestDto, createdById?: string) {
    const plan = await this.requireEditablePlan(planId);

    const duplicate = await this.prisma.scene.findUnique({
      where: { productionPlanId_sceneNumber: { productionPlanId: planId, sceneNumber: dto.sceneNumber } },
    });
    if (duplicate) {
      throw new ConflictException(`Scene number ${dto.sceneNumber} already exists in plan "${planId}"`);
    }

    const project = await this.prisma.productionProject.findUnique({ where: { id: plan.productionProjectId } });
    if (!project) throw new NotFoundException('Production project does not exist');

    await this.assertDurationAllowed(
      project,
      plan.targetDurationSeconds,
      plan.durationTotal + dto.targetDurationSeconds,
    );

    return this.prisma.$transaction(async (tx) => {
      const scene = await tx.scene.create({
        data: {
          productionPlanId: planId,
          sceneNumber: dto.sceneNumber,
          title: dto.title,
          scriptText: dto.scriptText,
          targetDurationSeconds: dto.targetDurationSeconds,
        },
      });
      await tx.productionPlan.update({
        where: { id: planId },
        data: { totalSceneCount: plan.totalSceneCount + 1 },
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
      await this.assertDurationAllowed(project, plan.targetDurationSeconds, otherTotal + dto.targetDurationSeconds);
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

  async submit(sceneId: string, dto: SubmitSceneRequestDto) {
    const scene = await this.findById(sceneId);

    const user = await this.prisma.user.findUnique({ where: { id: dto.submittedById } });
    if (!user) throw new BadRequestException(`User with id "${dto.submittedById}" does not exist`);
    if (user.role !== UserRole.CONTENT_CREATOR) {
      throw new ForbiddenException(`User with id "${dto.submittedById}" must have role CONTENT_CREATOR`);
    }

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
    const hasPendingJob = jobs.some((job) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status));
    if (hasPendingJob) {
      throw new ConflictException('Scene still has running/pending generation jobs');
    }
    const hasVideo = jobs.some((job) =>
      job.generatedAssets.some(
        (asset) => asset.assetType === AssetType.VIDEO && asset.status !== GeneratedAssetStatus.VALIDATION_FAILED,
      ),
    );
    if (!hasVideo) {
      throw new BadRequestException('Scene must have at least one VIDEO asset to be submitted');
    }
    if (jobs.some((job) => job.status === 'FAILED')) {
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
          submittedById: dto.submittedById,
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

  private async assertDurationAllowed(
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
