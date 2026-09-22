import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MilestoneStatus, ProductionProjectStatus, Prisma } from '@prisma/client';
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

  async update(id: string, dto: UpdateMilestoneRequestDto) {
    const milestone = await this.findById(id);

    const data: Prisma.MilestoneUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.targetDate !== undefined) data.targetDate = new Date(dto.targetDate);
    if (dto.resultText !== undefined) data.resultText = dto.resultText;

    const finalStatus = dto.status ?? milestone.status;

    if (milestone.status === MilestoneStatus.COMPLETED && finalStatus !== MilestoneStatus.COMPLETED) {
      throw new ConflictException('Cannot reopen a completed milestone');
    }
    if (finalStatus === MilestoneStatus.COMPLETED) {
      if (!(dto.resultText ?? milestone.resultText)) {
        throw new BadRequestException('resultText is required before marking a milestone as COMPLETED');
      }
      data.status = MilestoneStatus.COMPLETED;
      data.completedAt = new Date();
    } else if (finalStatus === MilestoneStatus.CANCELLED && milestone.status === MilestoneStatus.CANCELLED) {
      // no-op, idempotent
    } else {
      data.status = finalStatus;
    }

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
