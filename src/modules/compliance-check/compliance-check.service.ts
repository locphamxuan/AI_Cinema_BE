import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplianceCheckType, ComplianceResult, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateComplianceCheckRequestDto } from './dto/create-compliance-check.request.dto';
import { DecideComplianceCheckRequestDto } from './dto/decide-compliance-check.request.dto';
import { RecordComplianceReviewRequestDto } from './dto/record-compliance-review.request.dto';
import { AUTO_CHECKED, complianceVerdict, REQUIRED_COMPLIANCE_CHECKS } from './compliance-verdict';

interface CheckInput {
  checkType: ComplianceCheckType;
  policyId: string;
  result?: ComplianceResult;
  failureReason?: string | null;
  checkedBySystem?: string;
}

@Injectable()
export class ComplianceCheckService {
  constructor(private readonly prisma: PrismaService) {}

  async create(packageId: string, dto: CreateComplianceCheckRequestDto, checkedById: string) {
    await this.requirePackage(packageId);
    await this.requirePolicy(dto.policyId);
    return this.prisma.$transaction((tx) => this.createCheck(tx, packageId, dto, checkedById));
  }

  /**
   * Records a reviewer's full compliance pass in one transaction: every manual
   * check type must be answered, and the AI-label check is re-evaluated from the
   * package's labels. The response carries the package verdict (BR-42).
   */
  async recordReview(packageId: string, dto: RecordComplianceReviewRequestDto, checkedById: string) {
    await this.requirePackage(packageId);
    await this.requirePolicy(dto.policyId);

    const auto = dto.checks.find((c) => AUTO_CHECKED.includes(c.checkType));
    if (auto) throw new BadRequestException(`${auto.checkType} is evaluated automatically`);
    const answered = new Set(dto.checks.map((c) => c.checkType));
    const missing = REQUIRED_COMPLIANCE_CHECKS.filter((type) => !AUTO_CHECKED.includes(type) && !answered.has(type));
    if (missing.length > 0) throw new BadRequestException(`Missing compliance checks: ${missing.join(', ')}`);

    return this.prisma.$transaction(async (tx) => {
      const checks: Awaited<ReturnType<typeof this.createCheck>>[] = [];
      for (const check of dto.checks) {
        checks.push(await this.createCheck(tx, packageId, { ...check, policyId: dto.policyId }, checkedById));
      }
      for (const checkType of AUTO_CHECKED) {
        checks.push(await this.createCheck(tx, packageId, { checkType, policyId: dto.policyId }, checkedById));
      }
      return { verdict: complianceVerdict(checks), checks };
    });
  }

  async findAll(packageId: string) {
    await this.requirePackage(packageId);
    const checks = await this.prisma.complianceCheck.findMany({
      where: { episodePackageId: packageId },
      orderBy: { checkedAt: 'asc' },
      include: { policy: true, checkedBy: { select: { fullName: true } } },
    });
    return { verdict: complianceVerdict(checks), checks };
  }

  async decide(checkId: string, dto: DecideComplianceCheckRequestDto, checkedById: string) {
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
        checkedById,
        checkedAt: new Date(),
      },
      include: { policy: true },
    });
  }

  private async createCheck(tx: Prisma.TransactionClient, packageId: string, input: CheckInput, checkedById: string) {
    const isAuto = AUTO_CHECKED.includes(input.checkType);
    let result = input.result ?? ComplianceResult.PENDING;
    let failureReason = input.failureReason;
    let checkedBySystem = input.checkedBySystem;

    if (isAuto) {
      const labelCount = await tx.aiContentLabel.count({ where: { episodePackageId: packageId } });
      result = labelCount > 0 ? ComplianceResult.PASS : ComplianceResult.FAIL;
      failureReason = labelCount > 0 ? null : 'No AI content label has been applied to this package';
      checkedBySystem = checkedBySystem ?? 'ai-label-presence-auto-check';
    } else if (result === ComplianceResult.FAIL && !failureReason) {
      throw new BadRequestException(`failureReason is required when ${input.checkType} fails`);
    }

    return tx.complianceCheck.create({
      data: {
        episodePackageId: packageId,
        checkType: input.checkType,
        result,
        checkedById: isAuto ? null : checkedById,
        checkedBySystem,
        failureReason,
        checkedAt: result === ComplianceResult.PENDING ? null : new Date(),
        policyId: input.policyId,
      },
      include: { policy: true },
    });
  }

  private async requirePolicy(policyId: string) {
    const policy = await this.prisma.policy.findUnique({ where: { id: policyId } });
    if (!policy) throw new BadRequestException(`Policy with id "${policyId}" does not exist`);
    return policy;
  }

  private async requirePackage(packageId: string) {
    const pkg = await this.prisma.episodePackage.findUnique({ where: { id: packageId } });
    if (!pkg) throw new NotFoundException(`Episode package with id "${packageId}" does not exist`);
    return pkg;
  }
}
