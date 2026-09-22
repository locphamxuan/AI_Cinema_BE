import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplianceCheckType, ComplianceResult } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateComplianceCheckRequestDto } from './dto/create-compliance-check.request.dto';
import { DecideComplianceCheckRequestDto } from './dto/decide-compliance-check.request.dto';

const AUTO_CHECKED: ComplianceCheckType[] = [ComplianceCheckType.AI_LABEL_PRESENCE];
@Injectable()
export class ComplianceCheckService {
  constructor(private readonly prisma: PrismaService) {}

  async create(packageId: string, dto: CreateComplianceCheckRequestDto) {
    await this.requirePackage(packageId);

    const policy = await this.prisma.policy.findUnique({ where: { id: dto.policyId } });
    if (!policy) throw new BadRequestException(`Policy with id "${dto.policyId}" does not exist`);

    return this.prisma.$transaction(async (tx) => {
      let result = dto.result ?? ComplianceResult.PENDING;
      let failureReason: string | null | undefined = dto.failureReason;
      let checkedBySystem = dto.checkedBySystem;
      let checkedAt: Date | null = null;

      if (AUTO_CHECKED.includes(dto.checkType)) {
        const labelCount = await tx.aiContentLabel.count({ where: { episodePackageId: packageId } });
        result = labelCount > 0 ? ComplianceResult.PASS : ComplianceResult.FAIL;
        failureReason = labelCount > 0 ? null : 'No AI content label has been applied to this package';
        checkedBySystem = dto.checkedBySystem ?? 'ai-label-presence-auto-check';
      }

      if (result !== ComplianceResult.PENDING) {
        checkedAt = new Date();
      }

      const check = await tx.complianceCheck.create({
        data: {
          episodePackageId: packageId,
          checkType: dto.checkType,
          result,
          checkedBySystem,
          failureReason,
          checkedAt,
          policyId: policy.id,
        },
        include: { policy: true },
      });

      if (dto.checkType === ComplianceCheckType.AI_LABEL_PRESENCE) {
        await tx.complianceCheck.updateMany({
          where: {
            id: { not: check.id },
            episodePackageId: packageId,
            checkType: ComplianceCheckType.AI_LABEL_PRESENCE,
          },
          data: { result: ComplianceResult.PENDING, checkedAt: null, failureReason: null },
        });
      }

      return check;
    });
  }

  async findAll(packageId: string) {
    await this.requirePackage(packageId);
    return this.prisma.complianceCheck.findMany({
      where: { episodePackageId: packageId },
      orderBy: { id: 'asc' },
      include: { policy: true, checkedBy: { select: { fullName: true } } },
    });
  }

  async decide(checkId: string, dto: DecideComplianceCheckRequestDto) {
    const check = await this.prisma.complianceCheck.findUnique({ where: { id: checkId } });
    if (!check) throw new NotFoundException(`Compliance check with id "${checkId}" does not exist`);
    if (AUTO_CHECKED.includes(check.checkType)) {
      throw new ConflictException(
        `${check.checkType} is evaluated automatically - re-create it after adding labels instead`,
      );
    }

    return this.prisma.complianceCheck.update({
      where: { id: checkId },
      data: {
        result: dto.result,
        failureReason: dto.failureReason,
        checkedAt: new Date(),
      },
      include: { policy: true },
    });
  }

  private async requirePackage(packageId: string) {
    const pkg = await this.prisma.episodePackage.findUnique({ where: { id: packageId } });
    if (!pkg) throw new NotFoundException(`Episode package with id "${packageId}" does not exist`);
    return pkg;
  }
}
