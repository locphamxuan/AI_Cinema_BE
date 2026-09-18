import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductionProjectService } from 'src/modules/production-project/production-project.service';
import { CreateProductionPlanRequestDto } from './dto/create-production-plan.request.dto';

@Injectable()
export class ProductionPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productionProjectService: ProductionProjectService,
  ) {}

  async create(projectId: string, dto: CreateProductionPlanRequestDto) {
    await this.productionProjectService.findById(projectId);

    const user = await this.prisma.user.findUnique({ where: { id: dto.createdById } });
    if (!user) {
      throw new BadRequestException(`User with id "${dto.createdById}" does not exist`);
    }

    let planVersion = 1;
    if (dto.previousPlanId) {
      const previousPlan = await this.prisma.productionPlan.findFirst({
        where: { id: dto.previousPlanId, productionProjectId: projectId },
      });
      if (!previousPlan) {
        throw new BadRequestException(
          `Previous plan with id "${dto.previousPlanId}" does not belong to project "${projectId}"`,
        );
      }
      planVersion = previousPlan.planVersion + 1;
    } else {
      const lastPlan = await this.prisma.productionPlan.findFirst({
        where: { productionProjectId: projectId },
        orderBy: { planVersion: 'desc' },
      });
      planVersion = (lastPlan?.planVersion ?? 0) + 1;
    }

    return this.prisma.productionPlan.create({
      data: {
        productionProjectId: projectId,
        episodeNumber: dto.episodeNumber,
        planVersion,
        previousPlanId: dto.previousPlanId,
        scriptText: dto.scriptText,
        sceneBreakdown: dto.sceneBreakdown as Prisma.InputJsonValue,
        productionApproach: dto.productionApproach,
        targetDurationSeconds: dto.targetDurationSeconds,
        targetLanguages: dto.targetLanguages ?? [],
        estimatedAiResourceUsage: dto.estimatedAiResourceUsage,
        createdById: dto.createdById,
      },
    });
  }
}
