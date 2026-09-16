import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';

@Injectable()
export class ProductionProjectService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductionProjectRequestDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.createdById } });
    if (!user) {
      throw new BadRequestException(`User with id "${dto.createdById}" does not exist`);
    }

    return this.prisma.productionProject.create({
      data: {
        title: dto.title,
        description: dto.description,
        contentType: dto.contentType,
        createdById: dto.createdById,
        deadline: new Date(dto.deadline),
        plannedReleaseDate: new Date(dto.plannedReleaseDate),
        totalAiQuotaBudget: dto.totalAiQuotaBudget,
        remainingAiQuotaBudget: dto.totalAiQuotaBudget,
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
}
