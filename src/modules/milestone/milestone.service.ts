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
import { byTimeline, syncMilestoneClock } from './milestone-clock';

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
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
      },
    });
  }

  async findAll(projectId: string) {
    await this.requireProject(projectId);
    await syncMilestoneClock(this.prisma, projectId);
    const milestones = await this.prisma.milestone.findMany({ where: { productionProjectId: projectId } });
    return byTimeline(milestones);
  }

  async findById(id: string) {
    const milestone = await this.prisma.milestone.findUnique({ where: { id } });
    if (!milestone) {
      throw new NotFoundException(`Milestone with id "${id}" does not exist`);
    }
    return milestone;
  }

  /**
   * The Reviewer sets a milestone's title, description and dates, or cancels it. Its
   * status otherwise follows the clock (see milestone-clock.ts), so nobody sets it by
   * hand; the Creator can only note what was achieved.
   */
  async update(id: string, dto: UpdateMilestoneRequestDto, role: UserRole) {
    const milestone = await this.findById(id);

    const plan =
      dto.title !== undefined ||
      dto.description !== undefined ||
      dto.startDate !== undefined ||
      dto.targetDate !== undefined ||
      dto.status !== undefined;
    if (plan && role === UserRole.CONTENT_CREATOR) {
      throw new ForbiddenException(
        "Only the Reviewer can change a milestone's plan; its status follows the dates on its own",
      );
    }
    if (dto.status !== undefined && dto.status !== MilestoneStatus.CANCELLED) {
      throw new BadRequestException('A milestone status follows its dates; it can only be set to CANCELLED');
    }

    const startDate = dto.startDate !== undefined ? new Date(dto.startDate) : milestone.startDate;
    const targetDate = dto.targetDate !== undefined ? new Date(dto.targetDate) : milestone.targetDate;
    if (startDate && targetDate && startDate > targetDate) {
      throw new BadRequestException('startDate must be on or before targetDate');
    }

    const data: Prisma.MilestoneUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.startDate !== undefined) data.startDate = startDate;
    if (dto.targetDate !== undefined) data.targetDate = targetDate;
    if (dto.resultText !== undefined) data.resultText = dto.resultText;
    if (dto.status !== undefined) data.status = dto.status;

    await this.prisma.milestone.update({ where: { id }, data });
    // New dates can move it (and the ones after it) to another phase right away.
    await syncMilestoneClock(this.prisma, milestone.productionProjectId);
    return this.findById(id);
  }

  private async requireProject(projectId: string) {
    const project = await this.prisma.productionProject.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Production project with id "${projectId}" does not exist`);
    }
    return project;
  }
}
