import { Prisma } from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CreatePolicyDto } from './dto/create-policy.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';

@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginateQuery) {
    return paginate(query, this.prisma.policy, {
      sortableColumns: [
        'id',
        'name',
        'type',
        'version',
        'documentReference',
        'effectiveFrom',
        'effectiveTo',
        'isActive',
        'createdAt',
      ],
      defaultSortBy: [['name', 'ASC']],
      searchableColumns: ['name', 'documentReference'],
      filterableColumns: {
        type: ['$eq', '$in'],
        isActive: ['$eq'],
      },
    });
  }

  async create(dto: CreatePolicyDto) {
    return this.prisma.policy.create({
      data: {
        name: dto.name,
        type: dto.type,
        version: dto.version,
        documentReference: dto.documentReference ?? null,
        content: dto.content == null ? Prisma.DbNull : (dto.content as Prisma.InputJsonValue),
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdatePolicyDto) {
    const existing = await this.prisma.policy.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Policy not found', details: { reason: 'POLICY_NOT_FOUND' } });
    }
    return this.prisma.policy.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.version !== undefined && { version: dto.version }),
        ...(dto.documentReference !== undefined && { documentReference: dto.documentReference }),
        ...(dto.content !== undefined && {
          content: dto.content === null ? Prisma.DbNull : (dto.content as Prisma.InputJsonValue),
        }),
        ...(dto.effectiveFrom !== undefined && {
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        }),
        ...(dto.effectiveTo !== undefined && {
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.policy.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Policy not found', details: { reason: 'POLICY_NOT_FOUND' } });
    }
    return this.prisma.policy.delete({ where: { id } });
  }
}
