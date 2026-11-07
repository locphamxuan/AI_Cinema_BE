import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContractProposedBy, ContractStatus, StudioMilestoneStatus, type Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT, type ContentEvent } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { PROJECT_REF } from 'src/modules/production/project-access/project-relations';

const PERSON = { select: { id: true, fullName: true } } as const;
const DETAIL = {
  project: PROJECT_REF,
  handoff: { select: { id: true, milestoneStatus: true, studio: { select: { id: true, name: true } } } },
  createdBy: PERSON,
  adminSignedBy: PERSON,
} satisfies Prisma.ContractInclude;

type Detailed = Prisma.ContractGetPayload<{ include: typeof DETAIL }>;
type Project = Detailed['project'];

const STANDARD_TERMS =
  'Studio sản xuất đúng kịch bản và tiến độ đã thống nhất; nền tảng có quyền yêu cầu chỉnh sửa nội dung trước khi nghiệm thu.';

const vnd = (amount: number | bigint) => `${new Intl.NumberFormat('vi-VN').format(amount)} VND`;

/**
 * MF-1 contract negotiation: the system sends a template with no cost (round 1); the studio fills it in and
 * signs (`propose`); Admin signs to agree (`sign`) or counter-proposes a new cost (`counter`), which opens a
 * new round, until one round carries both signatures (SIGNED). A hand-off may only start production
 * (move to IN_PROGRESS) once it has a SIGNED round — enforced by MilestoneService.
 */
@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Admin: send a studio the template contract for one of the project's hand-offs (no cost yet). */
  async create(projectId: string, handoffId: string, terms: string | undefined, user: AuthenticatedUser) {
    const project = await this.access.project(projectId, user, 'read');
    const handoff = await this.assertHandoff(projectId, handoffId);
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.contract.findFirst({ where: { handoffId, status: { not: ContractStatus.SUPERSEDED } } });
      if (open) throw new ConflictException('This hand-off already has a contract being negotiated');
      const contract = await tx.contract.create({
        data: { projectId, handoffId, terms: terms?.trim() || STANDARD_TERMS, createdById: user.id },
        include: DETAIL,
      });
      await this.record(tx, contract, CONTENT_EVENT.CONTRACT_SENT, user.id, { handoffId });
      await this.tellTeam(tx, project, contract, `Hợp đồng mẫu đã gửi cho studio "${handoff.studio.name}".`);
      return contract;
    });
  }

  /** Every negotiation round of every hand-off of a project, oldest round first. */
  async list(projectId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    return this.prisma.contract.findMany({
      where: { projectId },
      orderBy: [{ handoffId: 'asc' }, { round: 'asc' }],
      include: DETAIL,
    });
  }

  /** Admin agrees with the cost the studio proposed: signs, completing the contract. */
  async sign(contractId: string, admin: AuthenticatedUser): Promise<Detailed> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await this.locked(tx, contractId);
      await this.access.project(contract.projectId, admin, 'read');
      if (contract.status !== ContractStatus.STUDIO_SIGNED) {
        throw new ConflictException('Only a contract the studio has signed can be countersigned');
      }
      await tx.contract.update({
        where: { id: contractId },
        data: { status: ContractStatus.SIGNED, adminSignedAt: new Date(), adminSignedById: admin.id },
      });
      const signed = await this.reload(tx, contractId);
      await this.record(tx, signed, CONTENT_EVENT.CONTRACT_SIGNED, admin.id, { costVnd: Number(signed.costVnd) });
      await this.tellTeam(
        tx,
        signed.project,
        signed,
        `Hợp đồng với studio "${signed.handoff.studio.name}" đã hoàn tất (${vnd(signed.costVnd!)}).`,
      );
      return signed;
    });
  }

  /** Admin disagrees: proposes a new cost, signs it, and opens a new round for the studio. */
  async counter(contractId: string, costVnd: number, admin: AuthenticatedUser): Promise<Detailed> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await this.locked(tx, contractId);
      await this.access.project(contract.projectId, admin, 'read');
      if (contract.status !== ContractStatus.STUDIO_SIGNED) {
        throw new ConflictException('Only a contract the studio has signed can be countered');
      }
      const next = await this.nextRound(tx, contract, {
        costVnd: BigInt(costVnd),
        proposedBy: ContractProposedBy.ADMIN,
        status: ContractStatus.ADMIN_COUNTERED,
        adminSignedAt: new Date(),
        adminSignedById: admin.id,
      });
      await this.record(tx, next, CONTENT_EVENT.CONTRACT_COUNTERED, admin.id, { costVnd });
      await this.tellTeam(
        tx,
        next.project,
        next,
        `Admin đề xuất giá mới ${vnd(costVnd)} cho studio "${next.handoff.studio.name}".`,
      );
      return next;
    });
  }

  /** Studio (via the Studio Web webhook): fills in the cost and signs the freshly sent template. */
  async propose(contractId: string, costVnd: number): Promise<Detailed> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await this.locked(tx, contractId);
      if (contract.status !== ContractStatus.SENT) {
        throw new ConflictException('Only a freshly sent template can be filled in by the studio');
      }
      await tx.contract.update({
        where: { id: contractId },
        data: {
          costVnd: BigInt(costVnd),
          proposedBy: ContractProposedBy.STUDIO,
          studioSignedAt: new Date(),
          status: ContractStatus.STUDIO_SIGNED,
        },
      });
      const proposed = await this.reload(tx, contractId);
      await this.record(tx, proposed, CONTENT_EVENT.CONTRACT_PROPOSED, null, { costVnd });
      await this.tellTeam(
        tx,
        proposed.project,
        proposed,
        `Studio "${proposed.handoff.studio.name}" báo giá ${vnd(costVnd)}, chờ Admin duyệt.`,
      );
      return proposed;
    });
  }

  /** Studio (via the webhook): agrees with Admin's countered cost, signs, completing the contract. */
  async studioSign(contractId: string): Promise<Detailed> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await this.locked(tx, contractId);
      if (contract.status !== ContractStatus.ADMIN_COUNTERED) {
        throw new ConflictException('Only a contract Admin countered can be signed by the studio');
      }
      await tx.contract.update({
        where: { id: contractId },
        data: { status: ContractStatus.SIGNED, studioSignedAt: new Date() },
      });
      const signed = await this.reload(tx, contractId);
      await this.record(tx, signed, CONTENT_EVENT.CONTRACT_SIGNED, null, { costVnd: Number(signed.costVnd) });
      await this.tellTeam(
        tx,
        signed.project,
        signed,
        `Studio "${signed.handoff.studio.name}" đồng ý, hợp đồng đã hoàn tất.`,
      );
      return signed;
    });
  }

  /** Studio (via the webhook): disagrees with Admin's countered cost, proposes another and signs it. */
  async studioCounter(contractId: string, costVnd: number): Promise<Detailed> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await this.locked(tx, contractId);
      if (contract.status !== ContractStatus.ADMIN_COUNTERED) {
        throw new ConflictException('Only a contract Admin countered can be answered with another price');
      }
      const next = await this.nextRound(tx, contract, {
        costVnd: BigInt(costVnd),
        proposedBy: ContractProposedBy.STUDIO,
        status: ContractStatus.STUDIO_SIGNED,
        studioSignedAt: new Date(),
      });
      await this.record(tx, next, CONTENT_EVENT.CONTRACT_COUNTERED, null, { costVnd });
      await this.tellTeam(
        tx,
        next.project,
        next,
        `Studio "${next.handoff.studio.name}" đề xuất giá khác ${vnd(costVnd)}, chờ Admin duyệt.`,
      );
      return next;
    });
  }

  /** Whether the hand-off has a fully signed round — the gate before it may move to IN_PROGRESS. */
  async isSigned(handoffId: string, tx?: PrismaTx): Promise<boolean> {
    const signed = await (tx ?? this.prisma).contract.count({ where: { handoffId, status: ContractStatus.SIGNED } });
    return signed > 0;
  }

  private async assertHandoff(projectId: string, handoffId: string) {
    const handoff = await this.prisma.studioHandoff.findFirst({
      where: { id: handoffId, projectId },
      include: { studio: { select: { id: true, name: true } } },
    });
    if (!handoff) throw new BadRequestException('The hand-off does not belong to this project');
    if (handoff.milestoneStatus === StudioMilestoneStatus.SUPERSEDED) {
      throw new ConflictException('That hand-off was replaced by another studio');
    }
    return handoff;
  }

  /** The contract, row-locked, so a double click cannot answer the same round twice. */
  private async locked(tx: PrismaTx, contractId: string): Promise<Detailed> {
    const found = await tx.contract.findUnique({ where: { id: contractId }, select: { id: true } });
    if (!found) throw new NotFoundException('Contract not found');
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
    return tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: DETAIL });
  }

  private reload(tx: PrismaTx, contractId: string): Promise<Detailed> {
    return tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: DETAIL });
  }

  /** Closes the current round (SUPERSEDED) and opens the next one with the new proposal. */
  private async nextRound(
    tx: PrismaTx,
    contract: Detailed,
    data: {
      costVnd: bigint;
      proposedBy: ContractProposedBy;
      status: ContractStatus;
      adminSignedAt?: Date;
      adminSignedById?: string;
      studioSignedAt?: Date;
    },
  ): Promise<Detailed> {
    await tx.contract.update({ where: { id: contract.id }, data: { status: ContractStatus.SUPERSEDED } });
    return tx.contract.create({
      data: {
        projectId: contract.projectId,
        handoffId: contract.handoffId,
        round: contract.round + 1,
        previousId: contract.id,
        terms: contract.terms,
        createdById: contract.createdById,
        ...data,
      },
      include: DETAIL,
    });
  }

  private async tellTeam(
    tx: PrismaTx,
    project: Project,
    contract: { id: string; handoffId: string },
    body: string,
  ): Promise<void> {
    const admins = await this.notifications.adminIds(tx);
    await this.notifications.notify(
      [...new Set([project.reviewerId, project.creatorId, ...admins].filter((id): id is string => !!id))],
      {
        type: NOTIFICATION_TYPE.CONTRACT_UPDATED,
        title: `Hợp đồng phim "${project.movie.title}" có cập nhật`,
        body,
        link: `/projects/${project.id}/contract`,
        payload: { projectId: project.id, contractId: contract.id, handoffId: contract.handoffId },
      },
      tx,
    );
  }

  private record(
    tx: PrismaTx,
    contract: { id: string; projectId: string },
    action: ContentEvent,
    actorId: string | null,
    payload: Record<string, unknown>,
  ) {
    return this.auditLog.record(
      { action, entityType: 'Contract', entityId: contract.id, projectId: contract.projectId, actorId, payload },
      tx,
    );
  }
}
