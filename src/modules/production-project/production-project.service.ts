import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { GenerationJobStatus, Prisma, ProductionProjectStatus, UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';
import { UpdateProductionProjectRequestDto } from './dto/update-production-project.request.dto';
import { CancelProductionProjectRequestDto } from './dto/cancel-production-project.request.dto';

@Injectable()
export class ProductionProjectService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductionProjectRequestDto) {
    const user = await this.requireReviewer(dto.createdById);

    this.ensureReleaseFlow(dto.deadline, dto.plannedReleaseDate);

    const existing = await this.prisma.productionProject.findFirst({
      where: { title: dto.title },
    });
    if (existing) {
      throw new ConflictException(`Production project with title "${dto.title}" already exists`);
    }

    return this.prisma.productionProject.create({
      data: {
        title: dto.title,
        description: dto.description,
        contentType: dto.contentType,
        createdById: user.id,
        deadline: new Date(dto.deadline),
        plannedReleaseDate: new Date(dto.plannedReleaseDate),
        totalAiQuotaBudget: dto.totalAiQuotaBudget,
        remainingAiQuotaBudget: dto.totalAiQuotaBudget,
      },
    });
  }

  async findAll(query: PaginateQuery) {
    return paginate(query, this.prisma.productionProject, {
      sortableColumns: [
        'id',
        'title',
        'description',
        'contentType',
        'status',
        'deadline',
        'plannedReleaseDate',
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
        productionPlans: {
          select: {
            id: true,
            episodeNumber: true,
            planVersion: true,
            status: true,
          },
          orderBy: { planVersion: 'asc' },
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

    return this.prisma.productionProject.update({ where: { id }, data });
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

  private ensureReleaseFlow(deadline: string, plannedReleaseDate: string) {
    if (new Date(plannedReleaseDate) < new Date(deadline)) {
      throw new BadRequestException('plannedReleaseDate must be on or after the deadline');
    }
  }

  private async getTotalAllocated(projectId: string): Promise<number> {
    const aggregation = await this.prisma.quotaAllocation.aggregate({
      where: { productionProjectId: projectId },
      _sum: { allocatedAmount: true },
    });
    return Number(aggregation._sum.allocatedAmount ?? 0);
  }
}
