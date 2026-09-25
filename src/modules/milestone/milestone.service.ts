import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MilestoneStatus, ProductionProjectStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMilestoneRequestDto } from './dto/create-milestone.request.dto';
import { UpdateMilestoneRequestDto } from './dto/update-milestone.request.dto';

@Injectable()
export class MilestoneService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, dto: CreateMilestoneRequestDto) {
    const project = await this.prisma.productionProject.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Production project with id "${projectId}" does not exist`);
    }
    if (project.status !== ProductionProjectStatus.DRAFT && project.status !== ProductionProjectStatus.ACTIVE) {
      throw new ConflictException('Cannot add a milestone to a CANCELLED or COMPLETED project');
    }

    return this.prisma.milestone.create({
      data: {
        productionProjectId: projectId,
        title: dto.title,
        description: dto.description,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
      },
    });
  }

  async findAll(projectId: string) {
    await this.requireProject(projectId);
    return this.prisma.milestone.findMany({
      where: { productionProjectId: projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string) {
    const milestone = await this.prisma.milestone.findUnique({ where: { id } });
    if (!milestone) {
      throw new NotFoundException(`Milestone with id "${id}" does not exist`);
    }
    return milestone;
  }

  /**
   * The Reviewer sets a milestone's title, description and date; the Creator only
   * reports progress on it. Completing needs a result, and a completed milestone
   * cannot be reopened.
   */
  async update(id: string, dto: UpdateMilestoneRequestDto, role: UserRole) {
    const milestone = await this.findById(id);

    const plan = dto.title !== undefined || dto.description !== undefined || dto.targetDate !== undefined;
    if (plan && role === UserRole.CONTENT_CREATOR) {
      throw new ForbiddenException("Only the Reviewer can change a milestone's title, description or date");
    }

    const data: Prisma.MilestoneUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.targetDate !== undefined) data.targetDate = new Date(dto.targetDate);
    if (dto.resultText !== undefined) data.resultText = dto.resultText;

    const status = dto.status ?? milestone.status;
    if (milestone.status === MilestoneStatus.COMPLETED && status !== MilestoneStatus.COMPLETED) {
      throw new ConflictException('Cannot reopen a completed milestone');
    }
    if (status === MilestoneStatus.COMPLETED && milestone.status !== MilestoneStatus.COMPLETED) {
      if (!(dto.resultText ?? milestone.resultText)?.trim()) {
        throw new BadRequestException('resultText is required before marking a milestone as COMPLETED');
      }
      data.completedAt = new Date();
    }
    data.status = status;

    return this.prisma.milestone.update({ where: { id }, data });
  }

  private async requireProject(projectId: string) {
    const project = await this.prisma.productionProject.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Production project with id "${projectId}" does not exist`);
    }
    return project;
  }
}
