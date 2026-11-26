import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PolicyType, type Policy } from '@prisma/client';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { aBoolean, assertFilterValues, oneOf } from 'src/common/validation/filter-values';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { inForceWhere } from './active-policy';
import { CreatePolicyDto } from './dto/create-policy.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';

const toDate = (value: string | null | undefined) => (value ? new Date(value) : null);

@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginateQuery) {
    assertFilterValues(query, { type: oneOf(Object.values(PolicyType)), isActive: aBoolean });
    return paginate(query, this.prisma.policy, {
      sortableColumns: [
        'name',
        'type',
        'version',
        'effectiveFrom',
        'effectiveTo',
        'isActive',
        'createdAt',
        'updatedAt',
      ],
      defaultSortBy: [['updatedAt', 'DESC']],
      searchableColumns: ['name', 'documentReference', 'content'],
      filterableColumns: {
        type: ['$eq', '$in'],
        isActive: ['$eq'],
      },
    });
  }

  /** The policies a Reviewer must follow right now, grouped by type (newest first within a type). */
  async inForce() {
    return this.prisma.policy.findMany({
      where: inForceWhere(),
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(dto: CreatePolicyDto) {
    const effectiveFrom = toDate(dto.effectiveFrom);
    const effectiveTo = toDate(dto.effectiveTo);
    assertRange(effectiveFrom, effectiveTo);
    return this.prisma.policy.create({
      data: {
        name: dto.name,
        type: dto.type,
        version: dto.version,
        documentReference: dto.documentReference ?? null,
        content: dto.content,
        effectiveFrom,
        effectiveTo,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdatePolicyDto) {
    const existing = await this.find(id);
    const effectiveFrom = dto.effectiveFrom !== undefined ? toDate(dto.effectiveFrom) : existing.effectiveFrom;
    const effectiveTo = dto.effectiveTo !== undefined ? toDate(dto.effectiveTo) : existing.effectiveTo;
    assertRange(effectiveFrom, effectiveTo);
    // Switched off, moved to another type or dated out of today: the type may lose its last policy in force.
    const after = { isActive: dto.isActive ?? existing.isActive, effectiveFrom, effectiveTo };
    const leavesType = !inForceNow(after) || (dto.type !== undefined && dto.type !== existing.type);

    return this.prisma.$transaction(async (tx) => {
      if (leavesType && inForceNow(existing)) await this.assertAnotherInForce(tx, existing);
      return this.write(tx, id, dto, effectiveFrom, effectiveTo);
    });
  }

  private write(tx: PrismaTx, id: string, dto: UpdatePolicyDto, effectiveFrom: Date | null, effectiveTo: Date | null) {
    return tx.policy.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.version !== undefined && { version: dto.version }),
        ...(dto.documentReference !== undefined && { documentReference: dto.documentReference }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.effectiveFrom !== undefined && { effectiveFrom }),
        ...(dto.effectiveTo !== undefined && { effectiveTo }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  /** Only a policy no label or compliance check recorded; a used one is switched off instead. */
  async remove(id: string) {
    const existing = await this.find(id);
    const [labels, checks] = await Promise.all([
      this.prisma.aiContentLabel.count({ where: { policyId: id } }),
      this.prisma.complianceCheck.count({ where: { policyId: id } }),
    ]);
    if (labels + checks > 0) {
      throw new ConflictException({
        message: 'This policy was used by recorded labels or compliance checks; switch it off instead',
        details: { reason: 'POLICY_IN_USE' },
      });
    }
    return this.prisma.$transaction(async (tx) => {
      if (inForceNow(existing)) await this.assertAnotherInForce(tx, existing);
      return tx.policy.delete({ where: { id } });
    });
  }

  private async find(id: string): Promise<Policy> {
    const existing = await this.prisma.policy.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Policy not found', details: { reason: 'POLICY_NOT_FOUND' } });
    }
    return existing;
  }

  /** Labelling and compliance checks need one policy of each type in force; the last one cannot leave. */
  private async assertAnotherInForce(tx: PrismaTx, policy: Policy) {
    // Two Admins switching off the last two policies of a type at once must not both succeed: they queue here.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`policy:${policy.type}`}))`;
    const others = await tx.policy.count({
      where: { ...inForceWhere(), type: policy.type, id: { not: policy.id } },
    });
    if (others === 0) {
      throw new ConflictException({
        message: 'This is the only policy of its type in force; add or switch on another one first',
        details: { reason: 'POLICY_LAST_IN_FORCE' },
      });
    }
  }
}

function inForceNow(p: Pick<Policy, 'isActive' | 'effectiveFrom' | 'effectiveTo'>, now = new Date()): boolean {
  return p.isActive && (!p.effectiveFrom || p.effectiveFrom <= now) && (!p.effectiveTo || p.effectiveTo > now);
}

function assertRange(from: Date | null, to: Date | null) {
  if (from && to && to <= from) {
    throw new BadRequestException({
      message: 'The end date must be after the start date',
      details: { reason: 'POLICY_DATE_RANGE' },
    });
  }
}
