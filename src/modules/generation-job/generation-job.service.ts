import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, QuotaAllocationStatus, GenerationJobStatus, GenerationJobType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateGenerationJobRequestDto } from './dto/create-generation-job.request.dto';
import { CreateGeneratedAssetRequestDto } from './dto/create-generated-asset.request.dto';
import { CompleteGenerationJobRequestDto } from './dto/complete-generation-job.request.dto';

const CANCELLABLE: GenerationJobStatus[] = [GenerationJobStatus.PENDING, GenerationJobStatus.QUEUED];
const VIDEO_ASSEMBLY: GenerationJobType = GenerationJobType.VIDEO_ASSEMBLY;

@Injectable()
export class GenerationJobService {
  constructor(private readonly prisma: PrismaService) {}

  async create(planId: string, dto: CreateGenerationJobRequestDto, createdById: string) {
    const plan = await this.prisma.productionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);

    const aiModel = await this.prisma.aiModel.findUnique({ where: { id: dto.aiModelId } });
    if (!aiModel) throw new BadRequestException(`AI model with id "${dto.aiModelId}" does not exist`);

    // const createdBy = await this.prisma.user.findUnique({ where: { id: dto.createdById } });
    // if (!createdBy) throw new BadRequestException(`User with id "${dto.createdById}" does not exist`);

    if (dto.sceneId) {
      const scene = await this.prisma.scene.findFirst({
        where: { id: dto.sceneId, productionPlanId: planId },
      });
      if (!scene) {
        throw new BadRequestException(`Scene "${dto.sceneId}" does not belong to plan "${planId}"`);
      }
    }

    let attemptNumber = 1;
    if (dto.parentJobId) {
      const parent = await this.prisma.generationJob.findFirst({
        where: { id: dto.parentJobId, productionPlanId: planId },
      });
      if (!parent) throw new BadRequestException(`Parent job "${dto.parentJobId}" does not belong to plan "${planId}"`);
      if (parent.status !== GenerationJobStatus.FAILED) {
        throw new ConflictException('A job can only be retried after it has FAILED');
      }
      attemptNumber = parent.attemptNumber + 1;
    }

    return this.prisma.generationJob.create({
      data: {
        productionPlanId: planId,
        aiModelId: dto.aiModelId,
        jobType: dto.jobType,
        sceneId: dto.sceneId,
        parentJobId: dto.parentJobId,
        configSnapshot: (dto.configSnapshot ?? undefined) as Prisma.InputJsonValue,
        attemptNumber,
        createdById,
      },
      include: { aiModel: true, scene: { select: { id: true, title: true } }, generatedAssets: true },
    });
  }

  async findAll(planId: string) {
    await this.requirePlan(planId);
    return this.prisma.generationJob.findMany({
      where: { productionPlanId: planId },
      orderBy: { createdAt: 'desc' },
      include: {
        aiModel: true,
        scene: { select: { id: true, title: true } },
        quotaAllocation: { select: { id: true, allocationType: true, remainingAmount: true } },
      },
    });
  }

  async findById(jobId: string) {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: {
        aiModel: true,
        scene: { select: { id: true, title: true } },
        createdBy: { select: { fullName: true } },
        quotaAllocation: { select: { id: true, allocationType: true, remainingAmount: true } },
      },
    });
    if (!job) throw new NotFoundException(`Generation job with id "${jobId}" does not exist`);
    return job;
  }

  async retry(jobId: string) {
    const job = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Generation job with id "${jobId}" does not exist`);
    if (job.status !== GenerationJobStatus.FAILED) {
      throw new ConflictException('A job can only be retried after it has FAILED');
    }

    return this.prisma.generationJob.create({
      data: {
        productionPlanId: job.productionPlanId,
        aiModelId: job.aiModelId,
        jobType: job.jobType,
        sceneId: job.sceneId,
        parentJobId: job.id,
        configSnapshot: job.configSnapshot === null ? undefined : (job.configSnapshot as Prisma.InputJsonValue),
        attemptNumber: job.attemptNumber + 1,
        quotaAllocationId: job.quotaAllocationId,
        createdById: job.createdById,
      },
      include: { aiModel: true, generatedAssets: true },
    });
  }

  async cancel(jobId: string) {
    const job = await this.findById(jobId);
    if (!CANCELLABLE.includes(job.status)) {
      throw new ConflictException(
        `Only ${CANCELLABLE.join('/')} jobs can be cancelled, current status "${job.status}"`,
      );
    }
    return this.prisma.generationJob.update({ where: { id: jobId }, data: { status: GenerationJobStatus.CANCELLED } });
  }

  async createGeneratedAsset(jobId: string, dto: CreateGeneratedAssetRequestDto) {
    // const job = await this.findById(jobId);

    return this.prisma.generatedAsset.create({
      data: {
        generationJobId: jobId,
        assetType: dto.assetType,
        language: dto.language,
        contentText: dto.contentText,
        storageKey: dto.storageKey,
        mimeType: dto.mimeType,
        fileSizeBytes: dto.fileSizeBytes,
        checksumSha256: dto.checksumSha256,
        durationSeconds: dto.durationSeconds,
        resolution: dto.resolution,
        metadata: dto.metadata ? (dto.metadata as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  async complete(jobId: string, dto: CompleteGenerationJobRequestDto) {
    const job = await this.findById(jobId);
    if (job.status !== GenerationJobStatus.RUNNING && job.status !== GenerationJobStatus.QUEUED) {
      throw new ConflictException(`Only RUNNING/QUEUED jobs can be completed, current status "${job.status}"`);
    }
    if (job.jobType === VIDEO_ASSEMBLY) {
      throw new ConflictException(
        'A VIDEO_ASSEMBLY job is finalized through the episode-package assemble endpoint, not complete()',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let quotaAllocationId = job.quotaAllocationId;

      if (dto.resourceCost !== undefined && dto.resourceCost > 0) {
        if (!quotaAllocationId) {
          const allocation = await tx.quotaAllocation.findFirst({
            where: { productionPlanId: job.productionPlanId, status: QuotaAllocationStatus.ACTIVE },
            orderBy: { createdAt: 'asc' },
          });
          quotaAllocationId = allocation?.id ?? null;
        }
        if (quotaAllocationId) {
          const allocation = await tx.quotaAllocation.update({
            where: { id: quotaAllocationId },
            data: { remainingAmount: { decrement: dto.resourceCost } },
          });
          if (Number(allocation.remainingAmount) < 0) {
            await tx.quotaAllocation.update({
              where: { id: quotaAllocationId },
              data: { remainingAmount: 0 },
            });
          }
        }
      }

      const updated = await tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: GenerationJobStatus.COMPLETED,
          completedAt: new Date(),
          resourceCost: dto.resourceCost ?? job.resourceCost,
          quotaAllocationId,
        },
        include: { generatedAssets: true, quotaAllocation: true },
      });

      await tx.quotaAllocation.updateMany({
        where: { productionPlanId: job.productionPlanId, status: QuotaAllocationStatus.ACTIVE, remainingAmount: 0 },
        data: { status: QuotaAllocationStatus.CONSUMED },
      });

      return updated;
    });
  }

  private async requirePlan(planId: string) {
    const plan = await this.prisma.productionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`Production plan with id "${planId}" does not exist`);
    return plan;
  }
}
