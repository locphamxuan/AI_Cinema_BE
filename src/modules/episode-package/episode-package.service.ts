import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EpisodePackageStatus,
  GeneratedAssetStatus,
  GenerationJobStatus,
  GenerationJobType,
  ProductionPlanStatus,
  SceneStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateEpisodePackageRequestDto } from './dto/create-episode-package.request.dto';

@Injectable()
export class EpisodePackageService {
  constructor(private readonly prisma: PrismaService) {}

  async assemble(planId: string, dto: CreateEpisodePackageRequestDto, assembledBy: string) {
    const plan = await this.prisma.productionPlan.findUnique({
      where: { id: planId },
      include: { scenes: { select: { id: true, title: true, status: true } } },
    });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    if (plan.status !== ProductionPlanStatus.APPROVED) {
      throw new ConflictException(
        `An episode package can only be assembled for an APPROVED plan, current status "${plan.status}"`,
      );
    }

    const notCompleted = plan.scenes.filter((s) => s.status !== SceneStatus.COMPLETED);
    if (notCompleted.length > 0) {
      throw new ConflictException(
        `All scenes must be COMPLETED before assembling. Still pending: ${notCompleted.map((s) => s.title).join(', ')}`,
      );
    }

    // if (dto.assembledById) {
    //   const user = await this.prisma.user.findUnique({ where: { id: dto.assembledById } });
    //   if (!user) throw new BadRequestException(`User with id "${dto.assembledById}" does not exist`);
    // }

    if (dto.assemblyJobId) {
      const job = await this.prisma.generationJob.findFirst({
        where: { id: dto.assemblyJobId, productionPlanId: planId },
      });
      if (!job)
        throw new BadRequestException(`Assembly job "${dto.assemblyJobId}" does not belong to plan "${planId}"`);
      if (job.jobType !== GenerationJobType.VIDEO_ASSEMBLY) {
        throw new BadRequestException('assemblyJobId must reference a VIDEO_ASSEMBLY job');
      }
      if (job.status !== GenerationJobStatus.COMPLETED) {
        throw new ConflictException('The VIDEO_ASSEMBLY job must be COMPLETED before assembling the package');
      }
    }

    let assetIds: string[] | null = null;
    if (dto.assetIds && dto.assetIds.length > 0) {
      assetIds = [...new Set(dto.assetIds)];
      const count = await this.prisma.generatedAsset.count({
        where: {
          id: { in: assetIds },
          generationJob: { productionPlanId: planId },
        },
      });
      if (count !== assetIds.length) {
        throw new BadRequestException('Some assetIds do not belong to this plan');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const lastPackage = await tx.episodePackage.findFirst({
        where: { productionPlanId: planId },
        orderBy: { packageVersion: 'desc' },
        select: { packageVersion: true },
      });

      await tx.episodePackage.updateMany({
        where: { productionPlanId: planId, status: EpisodePackageStatus.ASSEMBLED },
        data: { status: EpisodePackageStatus.SUPERSEDED },
      });

      const pkg = await tx.episodePackage.create({
        data: {
          productionPlanId: planId,
          packageVersion: (lastPackage?.packageVersion ?? 0) + 1,
          assembledBy,
          assemblyJobId: dto.assemblyJobId,
        },
      });

      let links = assetIds;
      if (!links) {
        const assets = await tx.generatedAsset.findMany({
          where: {
            generationJob: { productionPlanId: planId },
            status: { in: [GeneratedAssetStatus.GENERATED, GeneratedAssetStatus.ACCEPTED] },
          },
          select: { id: true },
        });
        links = assets.map((a) => a.id);
      }

      if (links.length > 0) {
        await tx.episodePackageAsset.createMany({
          data: links.map((generatedAssetId) => ({ episodePackageId: pkg.id, generatedAssetId })),
        });
      }

      return tx.episodePackage.findUnique({
        where: { id: pkg.id },
        include: {
          assets: { include: { generatedAsset: true } },
          assemblyJob: true,
          reviews: true,
          complianceChecks: true,
          aiContentLabels: true,
          submissions: true,
          publications: true,
        },
      });
    });
  }

  async findAll(planId: string) {
    await this.requirePlan(planId);
    return this.prisma.episodePackage.findMany({
      where: { productionPlanId: planId },
      orderBy: { createdAt: 'desc' },
      include: { assets: { include: { generatedAsset: true } } },
    });
  }

  async findById(packageId: string) {
    const pkg = await this.prisma.episodePackage.findUnique({
      where: { id: packageId },
      include: {
        assets: { include: { generatedAsset: true } },
        assemblyJob: true,
        reviews: { include: { reviewer: { select: { fullName: true } } } },
        complianceChecks: { include: { policy: true } },
        aiContentLabels: { include: { policy: true } },
        submissions: true,
        publications: true,
      },
    });
    if (!pkg) throw new NotFoundException(`Episode package with id "${packageId}" does not exist`);
    return pkg;
  }

  private async requirePlan(planId: string) {
    const plan = await this.prisma.productionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    return plan;
  }
}
