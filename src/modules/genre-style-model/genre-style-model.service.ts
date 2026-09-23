import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { AiModality, GenreStyleModelStatus, UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateGenreStyleModelRequestDto } from './dto/create-genre-style-model.request.dto';
import { AddTrainingSampleRequestDto } from './dto/add-training-sample.request.dto';
import { StartTrainingRequestDto } from './dto/start-training.request.dto';
import { CompleteTrainingRequestDto } from './dto/complete-training.request.dto';
import { LORA_TRAINING_PROVIDER } from './lora-training-provider';
import type { LoraTrainingProvider } from './lora-training-provider';

@Injectable()
export class GenreStyleModelService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LORA_TRAINING_PROVIDER) private readonly trainingProvider: LoraTrainingProvider,
  ) {}

  async create(dto: CreateGenreStyleModelRequestDto) {
    await this.requireReviewer(dto.createdById);

    const genre = await this.prisma.genre.findUnique({ where: { id: dto.genreId } });
    if (!genre) {
      throw new NotFoundException(`Genre with id "${dto.genreId}" does not exist`);
    }

    const baseAiModel = await this.prisma.aiModel.findUnique({ where: { id: dto.baseAiModelId } });
    if (!baseAiModel) {
      throw new NotFoundException(`AiModel with id "${dto.baseAiModelId}" does not exist`);
    }
    // Closed third-party APIs (Veo/Sora/Kling/Runway/Suno/Udio/ElevenLabs)
    // expose no fine-tuning endpoint — only open-weight IMAGE/VIDEO models
    // can host a LoRA adapter (PROJECT_OVERVIEW.md §4.1.8).
    if (baseAiModel.modality !== AiModality.IMAGE && baseAiModel.modality !== AiModality.VIDEO) {
      throw new BadRequestException(
        `AiModel "${baseAiModel.name}" has modality ${baseAiModel.modality}; only IMAGE or VIDEO models can host a LoRA style adapter`,
      );
    }

    const duplicateTrigger = await this.prisma.genreStyleModel.findFirst({
      where: { baseAiModelId: dto.baseAiModelId, triggerKeyword: dto.triggerKeyword },
    });
    if (duplicateTrigger) {
      throw new ConflictException(
        `triggerKeyword "${dto.triggerKeyword}" is already used for this base model — pick a different keyword or retrain the existing GenreStyleModel instead`,
      );
    }

    return this.prisma.genreStyleModel.create({
      data: {
        genreId: dto.genreId,
        baseAiModelId: dto.baseAiModelId,
        name: dto.name,
        triggerKeyword: dto.triggerKeyword,
        trainingProvider: dto.trainingProvider,
        minSampleThreshold: dto.minSampleThreshold ?? 15,
        createdById: dto.createdById,
      },
    });
  }

  async findAll(query: PaginateQuery) {
    return paginate(query, this.prisma.genreStyleModel, {
      sortableColumns: ['id', 'name', 'status', 'version', 'sampleCount', 'isActive', 'createdAt'],
      defaultSortBy: [['createdAt', 'DESC']],
      searchableColumns: ['name', 'triggerKeyword'],
      filterableColumns: {
        genreId: ['$eq'],
        baseAiModelId: ['$eq'],
        status: ['$eq', '$in'],
        isActive: ['$eq'],
      },
    });
  }

  async findById(id: string) {
    const styleModel = await this.prisma.genreStyleModel.findUnique({
      where: { id },
      include: { trainingSamples: { orderBy: { createdAt: 'asc' } } },
    });
    if (!styleModel) {
      throw new NotFoundException(`GenreStyleModel with id "${id}" does not exist`);
    }
    return styleModel;
  }

  /** Adds one file to the training "folder" for this genre style. */
  async addTrainingSample(styleModelId: string, dto: AddTrainingSampleRequestDto) {
    const styleModel = await this.findById(styleModelId);
    if (styleModel.status !== GenreStyleModelStatus.DRAFT && styleModel.status !== GenreStyleModelStatus.DATASET_READY) {
      throw new ConflictException(
        `Cannot add training samples to a GenreStyleModel with status "${styleModel.status}"`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const sample = await tx.genreStyleTrainingSample.create({
        data: { genreStyleModelId: styleModelId, storageKey: dto.storageKey, caption: dto.caption },
      });

      const sampleCount = await tx.genreStyleTrainingSample.count({ where: { genreStyleModelId: styleModelId } });
      const nextStatus =
        sampleCount >= styleModel.minSampleThreshold ? GenreStyleModelStatus.DATASET_READY : GenreStyleModelStatus.DRAFT;

      await tx.genreStyleModel.update({
        where: { id: styleModelId },
        data: { sampleCount, status: nextStatus },
      });

      return sample;
    });
  }

  /** Hands the current dataset off to the hosted LoRA-training provider. */
  async startTraining(styleModelId: string, dto: StartTrainingRequestDto) {
    await this.requireReviewer(dto.triggeredById);

    const styleModel = await this.findById(styleModelId);
    if (styleModel.status !== GenreStyleModelStatus.DATASET_READY) {
      throw new ConflictException(
        `GenreStyleModel "${styleModel.id}" is not ready for training (status "${styleModel.status}", needs DATASET_READY)`,
      );
    }
    if (styleModel.sampleCount < styleModel.minSampleThreshold) {
      throw new BadRequestException(
        `Only ${styleModel.sampleCount} training samples, need at least ${styleModel.minSampleThreshold}`,
      );
    }

    const baseAiModel = await this.prisma.aiModel.findUniqueOrThrow({ where: { id: styleModel.baseAiModelId } });
    const handle = await this.trainingProvider.submitTraining({
      baseModelName: baseAiModel.name,
      triggerKeyword: styleModel.triggerKeyword,
      samples: styleModel.trainingSamples.map((s) => ({ storageKey: s.storageKey, caption: s.caption })),
    });

    return this.prisma.genreStyleModel.update({
      where: { id: styleModelId },
      data: {
        status: GenreStyleModelStatus.TRAINING,
        trainingProvider: styleModel.trainingProvider ?? this.trainingProvider.name,
        externalTrainingJobId: handle.externalTrainingJobId,
      },
    });
  }

  /**
   * Records the training provider's result. On READY, this version becomes
   * the active one for its (baseAiModel, triggerKeyword) lineage and the
   * previously-active version (if any) is archived — never deleted, so the
   * old weights stay traceable/rollback-able.
   */
  async completeTraining(styleModelId: string, dto: CompleteTrainingRequestDto) {
    const styleModel = await this.findById(styleModelId);
    if (styleModel.status !== GenreStyleModelStatus.TRAINING) {
      throw new ConflictException(`GenreStyleModel "${styleModel.id}" is not currently TRAINING`);
    }

    if (dto.result === 'FAILED') {
      return this.prisma.genreStyleModel.update({
        where: { id: styleModelId },
        data: { status: GenreStyleModelStatus.FAILED, failureReason: dto.failureReason },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.genreStyleModel.updateMany({
        where: {
          baseAiModelId: styleModel.baseAiModelId,
          triggerKeyword: styleModel.triggerKeyword,
          isActive: true,
        },
        data: { isActive: false, status: GenreStyleModelStatus.ARCHIVED },
      });

      return tx.genreStyleModel.update({
        where: { id: styleModelId },
        data: {
          status: GenreStyleModelStatus.READY,
          storageKey: dto.storageKey,
          isActive: true,
          trainedAt: new Date(),
        },
      });
    });
  }

  /** Resolves which LoRA (if any) a visual generation job for this project should apply. */
  async resolveActiveStyleForProject(productionProjectId: string, baseAiModelId: string) {
    const project = await this.prisma.productionProject.findUnique({
      where: { id: productionProjectId },
      select: { primaryGenreId: true },
    });
    if (!project?.primaryGenreId) {
      return null;
    }

    return this.prisma.genreStyleModel.findFirst({
      where: { genreId: project.primaryGenreId, baseAiModelId, isActive: true, status: GenreStyleModelStatus.READY },
    });
  }

  private async requireReviewer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException(`User with id "${userId}" does not exist`);
    }
    if (user.role !== UserRole.CONTENT_REVIEWER) {
      throw new ForbiddenException(`User with id "${userId}" must have role CONTENT_REVIEWER`);
    }
    return user;
  }
}
