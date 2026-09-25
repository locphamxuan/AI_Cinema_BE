import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductionPlan, ProductionPlanStatus, SceneStatus } from '@prisma/client';
import { PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductionProjectService } from 'src/modules/production-project/production-project.service';
import { assertProjectOpen } from 'src/modules/production-project/project-lifecycle';
import { UpdateProductionPlanRequestDto } from './dto/update-production-plan.request.dto';
import { SubmitProductionPlanRequestDto } from './dto/submit-production-plan.request.dto';
import { CreateProductionPlanRevisionRequestDto } from './dto/create-production-plan-revision.request.dto';

type ProductionPlanDetail = Prisma.ProductionPlanGetPayload<{
  include: {
    productionProject: true;
    scenes: { orderBy: { sceneNumber: 'asc' } };
    planReviews: {
      orderBy: { createdAt: 'asc' };
      include: { reviewer: { select: { fullName: true } } };
    };
    submissions: { orderBy: { createdAt: 'desc' } };
    generationJobs: { select: { id: true; jobType: true; status: true; sceneId: true; createdAt: true } };
    episodePackages: { select: { id: true; packageVersion: true; status: true; createdAt: true } };
  };
}>;

@Injectable()
export class ProductionPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productionProjectService: ProductionProjectService,
  ) {}

  async findAll(projectId: string, query: PaginateQuery) {
    await this.productionProjectService.findById(projectId);

    const where: Prisma.ProductionPlanWhereInput = { productionProjectId: projectId };
    const limit = query.limit && query.limit > 0 && query.limit <= 100 ? query.limit : 20;
    const page = query.page && query.page > 0 ? query.page : 1;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.productionPlan.count({ where }),
      this.prisma.productionPlan.findMany({
        where,
        orderBy: [{ episodeNumber: 'asc' }, { planVersion: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          episodeNumber: true,
          seasonNumber: true,
          seasonEpisodeNumber: true,
          allottedDurationSeconds: true,
          planVersion: true,
          status: true,
          totalSceneCount: true,
          completedSceneCount: true,
          targetDurationSeconds: true,
          createdById: true,
          createdAt: true,
        },
      }),
    ]);

    return { items, total, page, limit };
  }

  async findById(planId: string): Promise<ProductionPlan>;

  async findById(planId: string, includeDetails: true): Promise<ProductionPlanDetail>;

  async findById(planId: string, includeDetails = false) {
    const plan = await this.prisma.productionPlan.findUnique({
      where: { id: planId },
      ...(includeDetails
        ? {
            include: {
              productionProject: true,
              scenes: { orderBy: { sceneNumber: 'asc' } },
              planReviews: { orderBy: { createdAt: 'asc' }, include: { reviewer: { select: { fullName: true } } } },
              submissions: { orderBy: { createdAt: 'desc' } },
              generationJobs: { select: { id: true, jobType: true, status: true, sceneId: true, createdAt: true } },
              episodePackages: { select: { id: true, packageVersion: true, status: true, createdAt: true } },
            },
          }
        : undefined),
    });
    if (!plan) {
      throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    }
    return plan;
  }

  async update(planId: string, dto: UpdateProductionPlanRequestDto) {
    const plan = await this.findById(planId);
    if (plan.status !== ProductionPlanStatus.DRAFT) {
      throw new ConflictException(`Cannot edit a plan with status "${plan.status}" - create a revision instead`);
    }

    const data: Prisma.ProductionPlanUpdateInput = {};
    if (dto.scriptText !== undefined) data.scriptText = dto.scriptText;
    if (dto.productionApproach !== undefined) data.productionApproach = dto.productionApproach;
    if (dto.targetLanguages !== undefined) data.targetLanguages = dto.targetLanguages;
    if (dto.estimatedAiResourceUsage !== undefined) data.estimatedAiResourceUsage = dto.estimatedAiResourceUsage;

    if (dto.targetDurationSeconds !== undefined) {
      const scenes = await this.prisma.scene.findMany({
        where: { productionPlanId: planId },
        select: { targetDurationSeconds: true },
      });
      const total = scenes.reduce((sum, scene) => sum + scene.targetDurationSeconds, 0);
      if (total > dto.targetDurationSeconds) {
        throw new BadRequestException(
          `targetDurationSeconds cannot be lowered below the current total scene duration (${total}s)`,
        );
      }
      const project = await this.prisma.productionProject.findUnique({
        where: { id: plan.productionProjectId },
      });
      if (project && project.defaultEpisodeDurationSeconds !== null) {
        if (dto.targetDurationSeconds > project.defaultEpisodeDurationSeconds) {
          throw new BadRequestException(
            `targetDurationSeconds cannot exceed the project default episode duration (${project.defaultEpisodeDurationSeconds}s)`,
          );
        }
      }
      data.targetDurationSeconds = dto.targetDurationSeconds;
    }

    return this.prisma.productionPlan.update({ where: { id: planId }, data });
  }

  async submit(planId: string, dto: SubmitProductionPlanRequestDto) {
    const plan = await this.findById(planId, true);
    assertProjectOpen(plan.productionProject);

    if (plan.status !== ProductionPlanStatus.DRAFT && plan.status !== ProductionPlanStatus.CHANGES_REQUESTED) {
      throw new ConflictException(`Only DRAFT or CHANGES_REQUESTED plans can be submitted, current "${plan.status}"`);
    }
    if (plan.scenes.length === 0) {
      throw new BadRequestException('A plan must have at least one scene before submission');
    }
    // Every scene is submitted together, so none is left behind in DRAFT.
    const submitted = new Set(dto.scenes.map((s) => s.sceneId));
    if (submitted.size !== plan.scenes.length || plan.scenes.some((s) => !submitted.has(s.id))) {
      throw new BadRequestException('scenes must list every scene of the plan exactly once');
    }

    // The duration checked is the one being submitted, not the plan's previous one.
    const total = plan.scenes.reduce((sum, scene) => sum + scene.targetDurationSeconds, 0);
    this.assertDurationAllowed(plan.productionProject, dto.targetDurationSeconds, total);

    return this.prisma.$transaction(async (tx) => {
      const updatedPlan = await tx.productionPlan.update({
        where: { id: planId },
        data: {
          scriptText: dto.scriptText,
          productionApproach: dto.productionApproach,
          targetDurationSeconds: dto.targetDurationSeconds,
          estimatedAiResourceUsage: dto.estimatedAiResourceUsage,
          totalSceneCount: dto.scenes.length,
          status: ProductionPlanStatus.SUBMITTED,
        },
      });

      for (const sceneDto of dto.scenes) {
        await tx.scene.update({
          where: { id: sceneDto.sceneId },
          data: { scriptText: sceneDto.scriptText, status: SceneStatus.SUBMITTED },
        });
      }

      return updatedPlan;
    });
  }

  async createRevision(
    projectId: string,
    planId: string,
    dto: CreateProductionPlanRevisionRequestDto,
    createdById: string,
  ) {
    const source = await this.findById(planId, true);
    if (source.productionProjectId !== projectId) {
      throw new BadRequestException(`Plan "${planId}" does not belong to project "${projectId}"`);
    }
    if (source.status !== ProductionPlanStatus.DRAFT && source.status !== ProductionPlanStatus.CHANGES_REQUESTED) {
      throw new ConflictException(
        `Can only revise a DRAFT or CHANGES_REQUESTED plan, current "${source.status}". Use POST /production-plans/:planId/submit instead.`,
      );
    }
    await this.productionProjectService.findById(projectId);

    const project = await this.prisma.productionProject.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Production project does not exist');

    const targetDuration = dto.targetDurationSeconds ?? source.targetDurationSeconds;
    const sceneTotal = source.scenes.reduce((sum, scene) => sum + scene.targetDurationSeconds, 0);
    if (targetDuration !== null && targetDuration !== undefined && sceneTotal > targetDuration) {
      throw new BadRequestException(
        `targetDurationSeconds (${targetDuration}s) is lower than the existing scene total (${sceneTotal}s)`,
      );
    }
    if (
      targetDuration &&
      project.defaultEpisodeDurationSeconds &&
      targetDuration > project.defaultEpisodeDurationSeconds
    ) {
      throw new BadRequestException(
        `targetDurationSeconds cannot exceed the project default episode duration (${project.defaultEpisodeDurationSeconds}s)`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const planVersion = await this.nextPlanVersion(tx, projectId, source.episodeNumber);
      const revised = await tx.productionPlan.create({
        data: {
          productionProjectId: projectId,
          episodeNumber: source.episodeNumber,
          seasonNumber: source.seasonNumber,
          seasonEpisodeNumber: source.seasonEpisodeNumber,
          allottedDurationSeconds: source.allottedDurationSeconds,
          planVersion,
          previousPlanId: source.id,
          scriptText: dto.scriptText ?? source.scriptText,
          productionApproach: dto.productionApproach ?? source.productionApproach,
          targetDurationSeconds: targetDuration,
          targetLanguages: dto.targetLanguages ?? source.targetLanguages,
          estimatedAiResourceUsage: dto.estimatedAiResourceUsage ?? source.estimatedAiResourceUsage,
          totalSceneCount: source.scenes.length,
          createdById,
        },
      });

      if (source.scenes.length > 0) {
        await tx.scene.createMany({
          data: source.scenes.map((scene) => ({
            productionPlanId: revised.id,
            sceneNumber: scene.sceneNumber,
            title: scene.title,
            scriptText: scene.scriptText,
            description: scene.description,
            targetDurationSeconds: scene.targetDurationSeconds,
            estimatedTokens: scene.estimatedTokens,
          })),
        });
      }

      return tx.productionPlan.findUnique({
        where: { id: revised.id },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
      });
    });
  }

  private async nextPlanVersion(
    tx: Prisma.TransactionClient,
    projectId: string,
    episodeNumber: number,
  ): Promise<number> {
    const last = await tx.productionPlan.findFirst({
      where: { productionProjectId: projectId, episodeNumber },
      orderBy: { planVersion: 'desc' },
      select: { planVersion: true },
    });
    return (last?.planVersion ?? 0) + 1;
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
    if (project.defaultEpisodeDurationSeconds !== null && total > project.defaultEpisodeDurationSeconds) {
      throw new BadRequestException(
        `Total scene duration (${total}s) exceeds the project episode duration limit (${project.defaultEpisodeDurationSeconds}s)`,
      );
    }
  }
}
