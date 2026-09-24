import { BadRequestException } from '@nestjs/common';
import { ComplianceCheckType, ComplianceResult } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ComplianceCheckService } from './compliance-check.service';
import { complianceVerdict } from './compliance-verdict';

const MANUAL = [
  ComplianceCheckType.CONTENT_POLICY,
  ComplianceCheckType.COPYRIGHT,
  ComplianceCheckType.LEGAL,
  ComplianceCheckType.WATERMARK,
  ComplianceCheckType.REAL_PERSON_LIKENESS,
];
const at = (minute: number) => new Date(2026, 8, 24, 10, minute);
const passAll = () =>
  Object.values(ComplianceCheckType).map((checkType) => ({
    checkType,
    result: ComplianceResult.PASS,
    checkedAt: at(1),
  }));

describe('complianceVerdict (BR-42 all-or-nothing)', () => {
  it('passes only when every check type passes', () => {
    expect(complianceVerdict(passAll())).toBe(ComplianceResult.PASS);
  });

  it('stays pending while a check type is missing', () => {
    expect(complianceVerdict(passAll().filter((c) => c.checkType !== ComplianceCheckType.WATERMARK))).toBe(
      ComplianceResult.PENDING,
    );
  });

  it('fails when any check type fails', () => {
    const checks = passAll().map((c) =>
      c.checkType === ComplianceCheckType.REAL_PERSON_LIKENESS ? { ...c, result: ComplianceResult.FAIL } : c,
    );
    expect(complianceVerdict(checks)).toBe(ComplianceResult.FAIL);
  });

  it('uses the latest decision of each type', () => {
    const checks = [
      ...passAll(),
      { checkType: ComplianceCheckType.COPYRIGHT, result: ComplianceResult.FAIL, checkedAt: at(0) },
    ];
    expect(complianceVerdict(checks)).toBe(ComplianceResult.PASS);
  });
});

describe('ComplianceCheckService.recordReview', () => {
  const tx = {
    aiContentLabel: { count: jest.fn() },
    complianceCheck: { create: jest.fn() },
  };
  const prisma = {
    episodePackage: { findUnique: jest.fn() },
    policy: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new ComplianceCheckService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.episodePackage.findUnique.mockResolvedValue({ id: 'pkg-id' });
    prisma.policy.findUnique.mockResolvedValue({ id: 'policy-id' });
    tx.complianceCheck.create.mockImplementation(({ data }: { data: object }) => Promise.resolve(data));
  });

  it('records every manual answer plus the automatic label check and returns the verdict', async () => {
    tx.aiContentLabel.count.mockResolvedValue(1);

    const { verdict, checks } = await service.recordReview(
      'pkg-id',
      { policyId: 'policy-id', checks: MANUAL.map((checkType) => ({ checkType, result: ComplianceResult.PASS })) },
      'reviewer-id',
    );

    expect(verdict).toBe(ComplianceResult.PASS);
    expect(checks).toHaveLength(MANUAL.length + 1);
    expect(checks.find((c) => c.checkType === ComplianceCheckType.CONTENT_POLICY)).toMatchObject({
      checkedById: 'reviewer-id',
    });
    expect(checks.find((c) => c.checkType === ComplianceCheckType.AI_LABEL_PRESENCE)).toMatchObject({
      result: ComplianceResult.PASS,
      checkedById: null,
    });
  });

  it('fails the package when no AI label was applied', async () => {
    tx.aiContentLabel.count.mockResolvedValue(0);

    const { verdict } = await service.recordReview(
      'pkg-id',
      { policyId: 'policy-id', checks: MANUAL.map((checkType) => ({ checkType, result: ComplianceResult.PASS })) },
      'reviewer-id',
    );

    expect(verdict).toBe(ComplianceResult.FAIL);
  });

  it('rejects a partial review and a failure without reason', async () => {
    await expect(
      service.recordReview(
        'pkg-id',
        { policyId: 'policy-id', checks: [{ checkType: ComplianceCheckType.LEGAL, result: ComplianceResult.PASS }] },
        'reviewer-id',
      ),
    ).rejects.toThrow('Missing compliance checks');

    tx.aiContentLabel.count.mockResolvedValue(1);
    await expect(
      service.recordReview(
        'pkg-id',
        {
          policyId: 'policy-id',
          checks: MANUAL.map((checkType) => ({
            checkType,
            result: checkType === ComplianceCheckType.WATERMARK ? ComplianceResult.FAIL : ComplianceResult.PASS,
          })),
        },
        'reviewer-id',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
