import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { GenerationJobStatus, Prisma, ProductionContentType, ProductionProjectStatus, UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';
import { UpdateProductionProjectRequestDto } from './dto/update-production-project.request.dto';
import { CancelProductionProjectRequestDto } from './dto/cancel-production-project.request.dto';

@Injectable()
export class ProductionProjectService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductionProjectRequestDto, createdById: string) {
    // const user = await this.requireReviewer(dto.createdById);
    await this.requireCreator(dto.assignedCreatorId);

    this.ensureReleaseFlow(dto.deadline, dto.plannedReleaseDate);
    this.ensureProductionStart(dto.productionStartDate, dto.deadline);

    const episodeCount = this.resolveEpisodeCount(dto.contentType, dto.episodeCount);

    const existing = await this.prisma.productionProject.findFirst({ where: { title: dto.title } });
    if (existing) {
      throw new ConflictException(`Production project with title "${dto.title}" already exists`);
    }

    const genreIds = [...new Set(dto.genreIds ?? [])];
    const policyIds = [...new Set(dto.policyIds ?? [])];
    await this.assertGenresExist(genreIds);
    await this.assertPoliciesExist(policyIds);

    const milestones = dto.milestones ?? [];
    this.assertMilestones(milestones);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.productionProject.create({
        data: {
          title: dto.title,
          description: dto.description,
          contentType: dto.contentType,
          defaultEpisodeDurationSeconds: dto.defaultEpisodeDurationSeconds,
          createdById,
          assignedCreatorId: dto.assignedCreatorId,
          episodeCount,
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

      for (let episodeNumber = 1; episodeNumber <= episodeCount; episodeNumber += 1) {
        await tx.productionPlan.create({
          data: {
            productionProjectId: project.id,
            episodeNumber,
            planVersion: 1,
            targetLanguages: [],
            createdById: project.assignedCreatorId,
          },
        });
      }

      return tx.productionProject.findUnique({
        where: { id: project.id },
        include: {
          ...this.projectInclude(),
          productionPlans: {
            select: {
              id: true,
              episodeNumber: true,
              planVersion: true,
              status: true,
              totalSceneCount: true,
              completedSceneCount: true,
            },
            orderBy: [{ episodeNumber: 'asc' }, { planVersion: 'desc' }],
          },
        },
      });
    });
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
    const project = await this.prisma.productionProject.findUnique({
      where: { id },
      include: {
        ...this.projectInclude(),
        // Everything the workspace needs to show where each episode is in MF-1,
        // newest plan version first per episode.
        productionPlans: {
          orderBy: [{ episodeNumber: 'asc' }, { planVersion: 'desc' }],
          include: {
            scenes: { orderBy: { sceneNumber: 'asc' } },
            planReviews: { orderBy: { createdAt: 'asc' } },
            quotaAllocations: { orderBy: { createdAt: 'asc' } },
            _count: { select: { generationJobs: true } },
            episodePackages: {
              orderBy: { packageVersion: 'desc' },
              take: 1,
              include: {
                submissions: { orderBy: { createdAt: 'desc' }, take: 1 },
                reviews: { orderBy: { createdAt: 'desc' }, take: 1 },
                complianceChecks: true,
                aiContentLabels: true,
                currentForEpisode: {
                  select: {
                    id: true,
                    productionStatus: true,
                    publications: { orderBy: { publishedAt: 'desc' }, take: 1 },
                  },
                },
              },
            },
          },
        },
      },
    });
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
      this.ensureReleaseFlow(
        dto.deadline ?? project.deadline.toISOString(),
        dto.plannedReleaseDate ?? project.plannedReleaseDate.toISOString(),
      );
    }

    if (dto.defaultEpisodeDurationSeconds !== undefined) {
      const maxTotal = await this.getMaxPlanSceneDuration(id);
      if (maxTotal > dto.defaultEpisodeDurationSeconds) {
        throw new BadRequestException(
          `defaultEpisodeDurationSeconds cannot be lower than the maximum current scene duration (${maxTotal}s)`,
        );
      }
      data.defaultEpisodeDurationSeconds = dto.defaultEpisodeDurationSeconds;
    }

    if (dto.totalAiQuotaBudget !== undefined) {
      const totalAllocated = await this.getTotalAllocated(id);
      if (dto.totalAiQuotaBudget < totalAllocated) {
        throw new BadRequestException(
          `totalAiQuotaBudget cannot be lower than the already allocated quota (${totalAllocated})`,
        );
      }
      const diff = dto.totalAiQuotaBudget - Number(project.totalAiQuotaBudget);
      data.totalAiQuotaBudget = dto.totalAiQuotaBudget;
      data.remainingAiQuotaBudget = Number(project.remainingAiQuotaBudget) + diff;
    }

    const genreIds = dto.genreIds !== undefined ? [...new Set(dto.genreIds)] : null;
    const policyIds = dto.policyIds !== undefined ? [...new Set(dto.policyIds)] : null;
    if (genreIds !== null) {
      await this.assertGenresExist(genreIds);
    }
    if (policyIds !== null) {
      await this.assertPoliciesExist(policyIds);
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

      return tx.productionProject.findUnique({
        where: { id },
        include: this.projectInclude(),
      });
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
          data: { status: 'CANCELLED' },
        });
      }

      return tx.productionProject.update({
        where: { id },
        data: { status: ProductionProjectStatus.CANCELLED, cancelledReason: dto.reason },
      });
    });
  }

  private projectInclude() {
    return {
      assignedCreator: { select: { id: true, fullName: true } },
      createdBy: { select: { id: true, fullName: true } },
      milestones: { orderBy: { createdAt: 'asc' as const } },
      productionProjectGenres: { include: { genre: true } },
      projectPolicies: { include: { policy: true } },
    };
  }

  // private async requireReviewer(userId: string) {
  //   const user = await this.prisma.user.findUnique({ where: { id: userId } });
  //   if (!user) {
  //     throw new BadRequestException(`User with id "${userId}" does not exist`);
  //   }
  //   if (user.role !== UserRole.CONTENT_REVIEWER) {
  //     throw new ForbiddenException(`User with id "${userId}" must have role CONTENT_REVIEWER`);
  //   }
  //   return user;
  // }

  private async requireCreator(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException(`User with id "${userId}" does not exist`);
    }
    if (user.role !== UserRole.CONTENT_CREATOR) {
      throw new ForbiddenException(`User with id "${userId}" must have role CONTENT_CREATOR`);
    }
    return user;
  }

  private resolveEpisodeCount(contentType: ProductionContentType, episodeCount?: number): number {
    if (contentType === ProductionContentType.SERIES) {
      if (episodeCount === undefined) {
        throw new BadRequestException('episodeCount is required for contentType SERIES');
      }
      return episodeCount;
    }
    return episodeCount ?? 1;
  }

  private assertMilestones(milestones: { title?: string; startDate?: string; targetDate?: string }[]) {
    for (const milestone of milestones) {
      if (
        milestone.startDate &&
        milestone.targetDate &&
        new Date(milestone.startDate) > new Date(milestone.targetDate)
      ) {
        throw new BadRequestException(
          `Milestone "${milestone.title ?? ''}" startDate must be on or before its targetDate`,
        );
      }
    }
  }

  private async assertGenresExist(genreIds: string[]) {
    if (genreIds.length === 0) return;
    const count = await this.prisma.genre.count({ where: { id: { in: genreIds } } });
    if (count !== genreIds.length) {
      throw new BadRequestException('One or more genreIds do not exist');
    }
  }

  private async assertPoliciesExist(policyIds: string[]) {
    if (policyIds.length === 0) return;
    const count = await this.prisma.policy.count({ where: { id: { in: policyIds } } });
    if (count !== policyIds.length) {
      throw new BadRequestException('One or more policyIds do not exist');
    }
  }

  private ensureReleaseFlow(deadline: string, plannedReleaseDate: string) {
    if (new Date(plannedReleaseDate) < new Date(deadline)) {
      throw new BadRequestException('plannedReleaseDate must be on or after the deadline');
    }
  }

  private ensureProductionStart(productionStartDate: string, deadline: string) {
    if (new Date(productionStartDate) >= new Date(deadline)) {
      throw new BadRequestException('productionStartDate must be before the deadline');
    }
  }

  private async getTotalAllocated(projectId: string): Promise<number> {
    const aggregation = await this.prisma.quotaAllocation.aggregate({
      where: { productionProjectId: projectId },
      _sum: { allocatedAmount: true },
    });
    return Number(aggregation._sum.allocatedAmount ?? 0);
  }

  private async getMaxPlanSceneDuration(projectId: string): Promise<number> {
    const plans = await this.prisma.productionPlan.findMany({
      where: { productionProjectId: projectId },
      include: { scenes: { select: { targetDurationSeconds: true } } },
    });
    let max = 0;
    for (const plan of plans) {
      const total = plan.scenes.reduce((sum, scene) => sum + scene.targetDurationSeconds, 0);
      if (total > max) max = total;
    }
    return max;
  }
}
