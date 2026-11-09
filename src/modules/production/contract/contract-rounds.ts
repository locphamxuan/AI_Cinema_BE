import { ConflictException, NotFoundException } from '@nestjs/common';
import { ContractStatus, type Prisma } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { PROJECT_REF } from 'src/modules/production/project-access/project-relations';

const PERSON = { select: { id: true, fullName: true } } as const;
export const CONTRACT_DETAIL = {
  project: PROJECT_REF,
  studio: { select: { id: true, name: true } },
  handoff: { select: { id: true, milestoneStatus: true } },
  createdBy: PERSON,
  adminSignedBy: PERSON,
} satisfies Prisma.ContractInclude;

export type Detailed = Prisma.ContractGetPayload<{ include: typeof CONTRACT_DETAIL }>;

/** Rounds still being negotiated: a project has at most one at a time. */
export const OPEN_CONTRACT_STATUSES: ContractStatus[] = [
  ContractStatus.SENT,
  ContractStatus.STUDIO_SIGNED,
  ContractStatus.ADMIN_COUNTERED,
];

export const STANDARD_TERMS =
  'Studio sản xuất đúng Kịch bản Final và tiến độ đã thống nhất; nền tảng có quyền yêu cầu chỉnh sửa nội dung trước khi nghiệm thu; Studio không chia sẻ phim cho bên thứ ba.';

export function assertContractStatus(contract: Detailed, expected: ContractStatus, action: string): void {
  if (contract.status !== expected) {
    throw new ConflictException(`Cannot ${action} a contract that is ${contract.status} (expected ${expected})`);
  }
}

/** The contract, row-locked, so a double click cannot answer the same round twice; a studio sees only its own. */
export async function lockedContract(tx: PrismaTx, contractId: string, studioId?: string): Promise<Detailed> {
  const found = await tx.contract.findUnique({ where: { id: contractId }, select: { id: true, studioId: true } });
  if (!found || (studioId && found.studioId !== studioId)) throw new NotFoundException('Contract not found');
  await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
  return tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: CONTRACT_DETAIL });
}

export function reloadContract(tx: PrismaTx, contractId: string): Promise<Detailed> {
  return tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: CONTRACT_DETAIL });
}

/** Closes the current round (SUPERSEDED) and opens the next one with the new proposal. */
export async function openNextRound(
  tx: PrismaTx,
  contract: Detailed,
  data: Pick<
    Prisma.ContractUncheckedCreateInput,
    'costVnd' | 'proposedBy' | 'status' | 'adminSignedAt' | 'adminSignedById' | 'studioSignedAt'
  >,
): Promise<Detailed> {
  await tx.contract.update({ where: { id: contract.id }, data: { status: ContractStatus.SUPERSEDED } });
  return tx.contract.create({
    data: {
      projectId: contract.projectId,
      studioId: contract.studioId,
      round: contract.round + 1,
      previousId: contract.id,
      terms: contract.terms,
      createdById: contract.createdById,
      ...data,
    },
    include: CONTRACT_DETAIL,
  });
}
