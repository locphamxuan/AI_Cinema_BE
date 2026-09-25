import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { GenerationJobStatus, Prisma, ProductionProjectStatus, UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { syncMilestoneClock } from 'src/modules/milestone/milestone-clock';
import { PlatformSettingService } from 'src/modules/platform-setting/platform-setting.service';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { DEFAULT_LANGUAGE } from 'src/common/validation/language-code';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';
import { UpdateProductionProjectRequestDto } from './dto/update-production-project.request.dto';
import { CancelProductionProjectRequestDto } from './dto/cancel-production-project.request.dto';
import {
  assertGenresExist,
  assertPoliciesExist,
  getMaxPlanSceneDuration,
  getTotalAllocated,
  requireCreator,
} from './project-lookups';
import { CREATED_PLANS_INCLUDE, PROJECT_DETAIL_INCLUDE, PROJECT_INCLUDE } from './project-includes';
import {
  assertMilestones,
  ensureProductionStart,
  ensureReleaseFlow,
  longestAllotted,
  resolveEpisodes,
} from './project-schedule';

@Injectable()
export class ProductionProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSetting: PlatformSettingService,
  ) {}

  async create(dto: CreateProductionProjectRequestDto, createdById: string) {
    await requireCreator(this.prisma, dto.assignedCreatorId);

    ensureReleaseFlow(dto.deadline, dto.plannedReleaseDate);
    ensureProductionStart(dto.productionStartDate, dto.deadline);

    const episodes = resolveEpisodes(dto);
    const defaultEpisodeDurationSeconds = dto.defaultEpisodeDurationSeconds ?? longestAllotted(episodes) ?? undefined;
    await this.platformSetting.assertEpisodeDurationAllowed([
      defaultEpisodeDurationSeconds,
      ...episodes.map((e) => e.allottedDurationSeconds),
    ]);

    const existing = await this.prisma.productionProject.findFirst({ where: { title: dto.title } });
    if (existing) {
      throw new ConflictException(`Production project with title "${dto.title}" already exists`);
    }

    const genreIds = [...new Set(dto.genreIds ?? [])];
    const policyIds = [...new Set(dto.policyIds ?? [])];
    await assertGenresExist(this.prisma, genreIds);
    await assertPoliciesExist(this.prisma, policyIds);

    const milestones = dto.milestones ?? [];
    assertMilestones(milestones);
    const subtitleLanguages = [...new Set(dto.subtitleLanguages ?? [DEFAULT_LANGUAGE])];

    const projectId = await this.prisma.$transaction(async (tx) => {
      const project = await tx.productionProject.create({
        data: {
          title: dto.title,
          description: dto.description,
          contentType: dto.contentType,
          defaultEpisodeDurationSeconds,
          createdById,
          assignedCreatorId: dto.assignedCreatorId,
          episodeCount: episodes.length,
          subtitleLanguages,
          productionStartDate: new Date(dto.productionStartDate),
          deadline: new Date(dto.deadline),
          plannedReleaseDate: new Date(dto.plannedReleaseDate),
          totalAiQuotaBudget: dto.totalAiQuotaBudget,
          remainingAiQuotaBudget: dto.totalAiQuotaBudget,
        },
      });

      if (genreIds.length > 0) {
        await tx.productionProjectGenre.createMany({
          data: genreIds.map((genreId) => ({ productionProjectId: project.id, genreId })),
        });
      }
      if (policyIds.length > 0) {
        await tx.projectPolicy.createMany({
          data: policyIds.map((policyId) => ({ productionProjectId: project.id, policyId })),
        });
      }
      if (milestones.length > 0) {
        await tx.milestone.createMany({
          data: milestones.map((milestone) => ({
            productionProjectId: project.id,
            title: milestone.title,
            description: milestone.description,
            startDate: milestone.startDate ? new Date(milestone.startDate) : null,
            targetDate: milestone.targetDate ? new Date(milestone.targetDate) : null,
          })),
        });
      }

      // One statement for every episode: the database sits across the ocean and an
      // interactive transaction is closed after 5s, so a round-trip per episode fails long series.
      await tx.productionPlan.createMany({
        data: episodes.map((episode, index) => ({
          productionProjectId: project.id,
          episodeNumber: index + 1,
          seasonNumber: episode.seasonNumber,
          seasonEpisodeNumber: episode.seasonEpisodeNumber,
          allottedDurationSeconds: episode.allottedDurationSeconds ?? defaultEpisodeDurationSeconds,
          planVersion: 1,
          targetLanguages: subtitleLanguages,
          createdById: project.assignedCreatorId,
        })),
      });

      return project.id;
    });

    return this.prisma.productionProject.findUnique({ where: { id: projectId }, include: CREATED_PLANS_INCLUDE });
  }

  /** Creators only see the projects assigned to them; reviewers and admins see all. */
  async findAll(query: PaginateQuery, user: AuthenticatedUser) {
    return paginate(query, this.prisma.productionProject, {
      where: user.role === UserRole.CONTENT_CREATOR ? { assignedCreatorId: user.id } : undefined,
      sortableColumns: [
        'id',
        'title',
        'description',
        'contentType',
        'status',
        'deadline',
        'plannedReleaseDate',
        'defaultEpisodeDurationSeconds',
        'totalAiQuotaBudget',
        'remainingAiQuotaBudget',
      ],
      defaultSortBy: [['title', 'ASC']],
      searchableColumns: ['title', 'description'],
      filterableColumns: {
        status: ['$eq', '$in'],
        contentType: ['$eq', '$in'],
      },
    });
  }

  async findById(id: string) {
    const project = await this.prisma.productionProject.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException(`Production project with id "${id}" does not exist`);
    }
    return project;
  }

  async findDetail(id: string) {
    await syncMilestoneClock(this.prisma, id);
    const project = await this.prisma.productionProject.findUnique({ where: { id }, include: PROJECT_DETAIL_INCLUDE });
    if (!project) {
      throw new NotFoundException(`Production project with id "${id}" does not exist`);
    }
    return project;
  }

  async update(id: string, dto: UpdateProductionProjectRequestDto) {
    const project = await this.findById(id);

    if (project.status === ProductionProjectStatus.CANCELLED || project.status === ProductionProjectStatus.COMPLETED) {
      throw new ConflictException(`Cannot update a production project with status "${project.status}"`);
    }

    const data: Prisma.ProductionProjectUpdateInput = {};

    if (dto.title !== undefined) {
      const existing = await this.prisma.productionProject.findFirst({
        where: { title: dto.title, id: { not: id } },
      });
      if (existing) {
        throw new ConflictException(`Production project with title "${dto.title}" already exists`);
      }
      data.title = dto.title;
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.deadline !== undefined) {
      data.deadline = new Date(dto.deadline);
    }
    if (dto.plannedReleaseDate !== undefined) {
      data.plannedReleaseDate = new Date(dto.plannedReleaseDate);
    }

    if (dto.deadline || dto.plannedReleaseDate) {
      ensureReleaseFlow(
        dto.deadline ?? project.deadline.toISOString(),
        dto.plannedReleaseDate ?? project.plannedReleaseDate.toISOString(),
      );
    }

    if (dto.defaultEpisodeDurationSeconds !== undefined) {
      await this.platformSetting.assertEpisodeDurationAllowed([dto.defaultEpisodeDurationSeconds]);
      const maxTotal = await getMaxPlanSceneDuration(this.prisma, id);
      if (maxTotal > dto.defaultEpisodeDurationSeconds) {
        throw new BadRequestException(
          `defaultEpisodeDurationSeconds cannot be lower than the maximum current scene duration (${maxTotal}s)`,
        );
      }
      data.defaultEpisodeDurationSeconds = dto.defaultEpisodeDurationSeconds;
    }

    if (dto.totalAiQuotaBudget !== undefined) {
      const totalAllocated = await getTotalAllocated(this.prisma, id);
      if (dto.totalAiQuotaBudget < totalAllocated) {
        throw new BadRequestException(
          `totalAiQuotaBudget cannot be lower than the already allocated quota (${totalAllocated})`,
        );
      }
      // Moved by the difference in the same statement as any concurrent allocation,
      // instead of overwriting the balance read above.
      const diff = dto.totalAiQuotaBudget - Number(project.totalAiQuotaBudget);
      data.totalAiQuotaBudget = dto.totalAiQuotaBudget;
      data.remainingAiQuotaBudget = { increment: diff };
    }

    const genreIds = dto.genreIds !== undefined ? [...new Set(dto.genreIds)] : null;
    const policyIds = dto.policyIds !== undefined ? [...new Set(dto.policyIds)] : null;
    if (genreIds !== null) {
      await assertGenresExist(this.prisma, genreIds);
    }
    if (policyIds !== null) {
      await assertPoliciesExist(this.prisma, policyIds);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.productionProject.update({ where: { id }, data });

      if (genreIds !== null) {
        await tx.productionProjectGenre.deleteMany({ where: { productionProjectId: id } });
        if (genreIds.length > 0) {
          await tx.productionProjectGenre.createMany({
            data: genreIds.map((genreId) => ({ productionProjectId: id, genreId })),
          });
        }
      }
      if (policyIds !== null) {
        await tx.projectPolicy.deleteMany({ where: { productionProjectId: id } });
        if (policyIds.length > 0) {
          await tx.projectPolicy.createMany({
            data: policyIds.map((policyId) => ({ productionProjectId: id, policyId })),
          });
        }
      }

      return tx.productionProject.findUnique({ where: { id }, include: PROJECT_INCLUDE });
    });
  }

  async cancel(id: string, dto: CancelProductionProjectRequestDto) {
    const project = await this.findById(id);

    if (project.status !== ProductionProjectStatus.DRAFT && project.status !== ProductionProjectStatus.ACTIVE) {
      throw new ConflictException(`Cannot cancel a production project with status "${project.status}"`);
    }

    const productionPlanIds = await this.prisma.productionPlan.findMany({
      where: { productionProjectId: id },
      select: { id: true },
    });

    const runningJob = await this.prisma.generationJob.findFirst({
      where: {
        productionPlanId: { in: productionPlanIds.map((plan) => plan.id) },
        status: GenerationJobStatus.RUNNING,
      },
    });
    if (runningJob) {
      throw new ConflictException('Cannot cancel the production project while a generation job is running');
    }

    return this.prisma.$transaction(async (tx) => {
      if (productionPlanIds.length > 0) {
        await tx.generationJob.updateMany({
          where: {
            productionPlanId: { in: productionPlanIds.map((plan) => plan.id) },
            status: { in: [GenerationJobStatus.PENDING, GenerationJobStatus.QUEUED] },
          },
          data: { status: GenerationJobStatus.CANCELLED },
        });
      }

      return tx.productionProject.update({
        where: { id },
        data: { status: ProductionProjectStatus.CANCELLED, cancelledReason: dto.reason },
      });
    });
  }
}
