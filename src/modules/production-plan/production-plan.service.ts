import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductionPlan,
  ProductionPlanStatus,
  SceneStatus,
  SubmissionStatus,
  SubmissionType,
  UserRole,
} from '@prisma/client';
import { PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductionProjectService } from 'src/modules/production-project/production-project.service';
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

  // async create(projectId: string, dto: CreateProductionPlanRequestDto) {
  //   const project = await this.productionProjectService.findById(projectId);

  //   if (project.status !== ProductionProjectStatus.DRAFT && project.status !== ProductionProjectStatus.ACTIVE) {
  //     throw new ConflictException(`Cannot create a plan on a project with status "${project.status}"`);
  //   }

  //   await this.requireCreator(dto.createdById);

  //   const scenes = dto.scenes ?? [];
  //   if (scenes.length > 0) {
  //     this.assertUniqueSceneNumbers(scenes.map((s) => s.sceneNumber));
  //     this.assertDurationAllowed(project, dto.targetDurationSeconds ?? null, this.sceneSum(scenes));
  //   }
  //   if (dto.targetDurationSeconds && project.defaultEpisodeDurationSeconds !== null) {
  //     if (dto.targetDurationSeconds > project.defaultEpisodeDurationSeconds) {
  //       throw new BadRequestException(
  //         `targetDurationSeconds (${dto.targetDurationSeconds}s) cannot exceed the project default episode duration (${project.defaultEpisodeDurationSeconds}s)`,
  //       );
  //     }
  //   }

  //   return this.prisma.$transaction(async (tx) => {
  //     const { episodeNumber, previousPlanId } = await this.resolveEpisode(tx, project, projectId, dto);
  //     const planVersion = await this.nextPlanVersion(tx, projectId, episodeNumber);

  //     const plan = await tx.productionPlan.create({
  //       data: {
  //         productionProjectId: projectId,
  //         episodeNumber,
  //         planVersion,
  //         previousPlanId,
  //         scriptText: dto.scriptText,
  //         productionApproach: dto.productionApproach,
  //         targetDurationSeconds: dto.targetDurationSeconds,
  //         targetLanguages: dto.targetLanguages ?? [],
  //         estimatedAiResourceUsage: dto.estimatedAiResourceUsage,
  //         totalSceneCount: scenes.length,
  //         createdById: dto.createdById,
  //       },
  //     });

  //     if (scenes.length > 0) {
  //       await tx.scene.createMany({
  //         data: scenes.map((scene) => ({
  //           productionPlanId: plan.id,
  //           sceneNumber: scene.sceneNumber,
  //           title: scene.title,
  //           scriptText: scene.scriptText,
  //           targetDurationSeconds: scene.targetDurationSeconds,
  //         })),
  //       });
  //     }

  //     return tx.productionPlan.findUnique({
  //       where: { id: plan.id },
  //       include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
  //     });
  //   });
  // }

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

    if (plan.status !== ProductionPlanStatus.DRAFT && plan.status !== ProductionPlanStatus.CHANGES_REQUESTED) {
      throw new ConflictException(`Only DRAFT or CHANGES_REQUESTED plans can be submitted, current "${plan.status}"`);
    }
    if (plan.totalSceneCount === 0) {
      throw new BadRequestException('A plan must have at least one scene before submission');
    }

    const project = await this.prisma.productionProject.findUnique({ where: { id: plan.productionProjectId } });
    if (!project) throw new NotFoundException('Production project does not exist');

    const total = plan.scenes.reduce((sum, scene) => sum + scene.targetDurationSeconds, 0);
    this.assertDurationAllowed(project, plan.targetDurationSeconds, total);

    return this.prisma.$transaction(async (tx) => {
      const updatedPlan = await tx.productionPlan.update({
        where: { id: planId },
        data: { status: ProductionPlanStatus.SUBMITTED },
      });

      await tx.scene.updateMany({
        where: { productionPlanId: planId },
        data: { status: SceneStatus.SUBMITTED },
      });

      const submission = await tx.submission.create({
        data: {
          submissionType: SubmissionType.PLAN,
          productionPlanId: planId,
          status: SubmissionStatus.SUBMITTED,
          note: dto.note,
          submittedById: plan.createdById,
          submittedAt: new Date(),
        },
      });

      return { plan: updatedPlan, submission };
    });
  }

  async createRevision(projectId: string, planId: string, dto: CreateProductionPlanRevisionRequestDto) {
    const source = await this.findById(planId, true);
    if (source.productionProjectId !== projectId) {
      throw new BadRequestException(`Plan "${planId}" does not belong to project "${projectId}"`);
    }
    if (source.status !== ProductionPlanStatus.DRAFT && source.status !== ProductionPlanStatus.CHANGES_REQUESTED) {
      throw new ConflictException(
        `Can only revise a DRAFT or CHANGES_REQUESTED plan, current "${source.status}". Use POST /production-plans/:planId/submit instead.`,
      );
    }
    await this.requireCreator(dto.createdById);
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
          planVersion,
          previousPlanId: source.id,
          scriptText: dto.scriptText ?? source.scriptText,
          productionApproach: dto.productionApproach ?? source.productionApproach,
          targetDurationSeconds: targetDuration,
          targetLanguages: dto.targetLanguages ?? source.targetLanguages,
          estimatedAiResourceUsage: dto.estimatedAiResourceUsage ?? source.estimatedAiResourceUsage,
          totalSceneCount: source.scenes.length,
          createdById: dto.createdById,
        },
      });

      if (source.scenes.length > 0) {
        await tx.scene.createMany({
          data: source.scenes.map((scene) => ({
            productionPlanId: revised.id,
            sceneNumber: scene.sceneNumber,
            title: scene.title,
            scriptText: scene.scriptText,
            targetDurationSeconds: scene.targetDurationSeconds,
          })),
        });
      }

      return tx.productionPlan.findUnique({
        where: { id: revised.id },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } },
      });
    });
  }

  // private async resolveEpisode(
  //   tx: Prisma.TransactionClient,
  //   project: { contentType: ProductionContentType },
  //   projectId: string,
  //   dto: CreateProductionPlanRequestDto,
  // ): Promise<{ episodeNumber: number; previousPlanId?: string }> {
  //   if (dto.previousPlanId) {
  //     const previousPlan = await tx.productionPlan.findFirst({
  //       where: { id: dto.previousPlanId, productionProjectId: projectId },
  //       select: { id: true, episodeNumber: true },
  //     });
  //     if (!previousPlan) {
  //       throw new BadRequestException(
  //         `Previous plan with id "${dto.previousPlanId}" does not belong to project "${projectId}"`,
  //       );
  //     }
  //     if (dto.episodeNumber !== undefined && dto.episodeNumber !== previousPlan.episodeNumber) {
  //       throw new BadRequestException(
  //         `episodeNumber (${dto.episodeNumber}) does not match the previous plan's episode (${previousPlan.episodeNumber})`,
  //       );
  //     }
  //     return { episodeNumber: previousPlan.episodeNumber, previousPlanId: previousPlan.id };
  //   }

  //   return {
  //     episodeNumber:
  //       project.contentType === ProductionContentType.MOVIE
  //         ? 1
  //         : (dto.episodeNumber ?? (await this.nextEpisodeNumber(tx, projectId))),
  //   };
  // }

  // private async nextEpisodeNumber(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
  //   const last = await tx.productionPlan.findFirst({
  //     where: { productionProjectId: projectId },
  //     orderBy: { episodeNumber: 'desc' },
  //     select: { episodeNumber: true },
  //   });
  //   return (last?.episodeNumber ?? 0) + 1;
  // }

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

  private async requireCreator(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException(`User with id "${userId}" does not exist`);
    }
    if (user.role !== UserRole.CONTENT_CREATOR) {
      throw new ForbiddenException(`User with id "${userId}" must have role CONTENT_CREATOR`);
    }
  }

  // private assertUniqueSceneNumbers(sceneNumbers: number[]) {
  //   const unique = new Set(sceneNumbers);
  //   if (unique.size !== sceneNumbers.length) {
  //     throw new BadRequestException('sceneNumber must be unique within a plan');
  //   }
  // }

  // private sceneSum(scenes: { targetDurationSeconds: number }[]): number {
  //   return scenes.reduce((sum, scene) => sum + scene.targetDurationSeconds, 0);
  // }

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
