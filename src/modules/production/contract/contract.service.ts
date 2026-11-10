import { ConflictException, Injectable } from '@nestjs/common';
import { ContractProposedBy, ContractStatus, ProjectStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import { ContractHandoffService } from './contract-handoff.service';
import { queueContractMail, recordContractEvent, tellContractUpdate } from './contract-notice';
import {
  assertContractStatus,
  CONTRACT_DETAIL,
  lockedContract,
  OPEN_CONTRACT_STATUSES,
  openNextRound,
  reloadContract,
  STANDARD_TERMS,
  type Detailed,
} from './contract-rounds';

export interface SentTemplate {
  contract: Detailed;
  /** The email telling the studio; send it with StudioMailService.dispatch once the transaction committed. */
  mailId: string | null;
}

const vnd = (amount: number | bigint) => `${new Intl.NumberFormat('vi-VN').format(amount)} VND`;

/**
 * MF-1 §3–4 contract negotiation: once the Admin approves the Final Script the system sends the project's studio
 * a template with no cost (round 1); the studio fills it in and signs (`propose`); the Admin signs to agree
 * (`sign`) or counter-proposes a new cost (`counter`), which opens a new round, until one round carries both
 * signatures (SIGNED). Signing hands the project off to the studio (ContractHandoffService).
 */
@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly handoffs: ContractHandoffService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
    private readonly mails: StudioMailService,
  ) {}

  /** The system sends the project's studio its template contract (no cost yet); also the Admin's resend. */
  async sendTemplate(tx: PrismaTx, projectId: string, actorId: string, terms?: string): Promise<SentTemplate> {
    const project = await tx.movieProject.findUniqueOrThrow({ where: { id: projectId } });
    if (!project.studioId) throw new ConflictException('Pick the studio of the project before sending its contract');
    if (project.status !== ProjectStatus.ASSIGNED) {
      throw new ConflictException(`A contract is only sent while the project is ASSIGNED, not ${project.status}`);
    }
    const open = await tx.contract.count({
      where: { projectId, status: { in: [...OPEN_CONTRACT_STATUSES, ContractStatus.SIGNED] } },
    });
    if (open) throw new ConflictException('This project already has a contract');
    const contract = await this.openRound(tx, { projectId, studioId: project.studioId, actorId, terms });
    const title = contract.project.movie.title;
    const mailId = await queueContractMail(
      this.mails,
      tx,
      contract,
      actorId,
      `Hợp đồng phim "${title}": mời Studio báo giá`,
      '/contracts',
      [
        `Kịch bản Final của phim "${title}" đã được duyệt và hợp đồng mẫu đã sẵn sàng.`,
        'Vui lòng đăng nhập Studio Web để xem điều khoản, điền chi phí sản xuất và ký.',
      ],
    );
    return { contract, mailId };
  }

  /**
   * BR-59 studio change: the rounds still being negotiated are SUPERSEDED (a SIGNED one stays as history) and
   * the new studio gets a template for the hand-off waiting on it. The caller emails the studio with its brief.
   */
  async sendForStudioChange(
    tx: PrismaTx,
    change: { projectId: string; studioId: string; handoffId: string; actorId: string },
  ): Promise<Detailed> {
    const { projectId, studioId, handoffId, actorId } = change;
    await tx.contract.updateMany({
      where: { projectId, status: { in: OPEN_CONTRACT_STATUSES } },
      data: { status: ContractStatus.SUPERSEDED },
    });
    return this.openRound(tx, { projectId, studioId, actorId, handoffId });
  }

  /** Round 1 of a negotiation: a template with no cost, as both the first contract and a studio change send it. */
  private async openRound(
    tx: PrismaTx,
    round: { projectId: string; studioId: string; actorId: string; terms?: string; handoffId?: string },
  ): Promise<Detailed> {
    const { projectId, studioId, actorId, terms, handoffId } = round;
    const contract = await tx.contract.create({
      data: { projectId, studioId, handoffId, terms: terms?.trim() || STANDARD_TERMS, createdById: actorId },
      include: CONTRACT_DETAIL,
    });
    await recordContractEvent(this.auditLog, tx, contract, CONTENT_EVENT.CONTRACT_SENT, actorId, { studioId });
    const body = `Hợp đồng mẫu đã gửi cho studio "${contract.studio.name}", chờ Studio báo giá.`;
    await tellContractUpdate(this.notifications, tx, contract, body);
    return contract;
  }

  /** Admin: send the template again, e.g. once the project's studio changed. */
  async resend(projectId: string, terms: string | undefined, admin: AuthenticatedUser): Promise<Detailed> {
    await this.access.project(projectId, admin, 'read');
    const { contract, mailId } = await this.prisma.$transaction((tx) =>
      this.sendTemplate(tx, projectId, admin.id, terms),
    );
    await this.mails.dispatch(mailId);
    return contract;
  }

  /** Every negotiation round of a project, oldest first. */
  async list(projectId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    return this.prisma.contract.findMany({ where: { projectId }, orderBy: { round: 'asc' }, include: CONTRACT_DETAIL });
  }

  /** Every round sent to one studio, newest first (the studio's own view). */
  forStudio(studioId: string) {
    return this.prisma.contract.findMany({
      where: { studioId },
      orderBy: [{ updatedAt: 'desc' }],
      include: CONTRACT_DETAIL,
    });
  }

  /** Admin agrees with the cost the studio proposed: signs, completing the contract and handing the project off. */
  async sign(contractId: string, admin: AuthenticatedUser): Promise<Detailed> {
    return this.withMail(async (tx, mailIds) => {
      const contract = await lockedContract(tx, contractId);
      await this.access.project(contract.projectId, admin, 'read');
      assertContractStatus(contract, ContractStatus.STUDIO_SIGNED, 'countersign');
      await tx.contract.update({
        where: { id: contractId },
        data: { status: ContractStatus.SIGNED, adminSignedAt: new Date(), adminSignedById: admin.id },
      });
      return this.complete(tx, contractId, admin.id, mailIds);
    });
  }

  /** Admin disagrees: proposes a new cost, signs it, and opens a new round for the studio. */
  async counter(contractId: string, costVnd: number, admin: AuthenticatedUser): Promise<Detailed> {
    return this.withMail(async (tx, mailIds) => {
      const contract = await lockedContract(tx, contractId);
      await this.access.project(contract.projectId, admin, 'read');
      assertContractStatus(contract, ContractStatus.STUDIO_SIGNED, 'counter');
      await this.handoffs.assertAffordable(tx, contract.projectId, costVnd, contract.handoffId);
      const next = await openNextRound(tx, contract, {
        costVnd: BigInt(costVnd),
        proposedBy: ContractProposedBy.ADMIN,
        status: ContractStatus.ADMIN_COUNTERED,
        adminSignedAt: new Date(),
        adminSignedById: admin.id,
      });
      await recordContractEvent(this.auditLog, tx, next, CONTENT_EVENT.CONTRACT_COUNTERED, admin.id, { costVnd });
      await tellContractUpdate(
        this.notifications,
        tx,
        next,
        `Admin đề xuất giá mới ${vnd(costVnd)} (đã ký), chờ studio "${next.studio.name}".`,
      );
      const title = next.project.movie.title;
      mailIds.push(
        await queueContractMail(
          this.mails,
          tx,
          next,
          admin.id,
          `Hợp đồng phim "${title}": Admin đề xuất chi phí mới`,
          '/contracts',
          [
            `Admin đề xuất chi phí sản xuất ${vnd(costVnd)} cho phim "${title}" và đã ký.`,
            'Vui lòng đăng nhập Studio Web để đồng ý và ký, hoặc đề xuất mức chi phí khác.',
          ],
        ),
      );
      return next;
    });
  }

  /** Studio: fills in the cost and signs the freshly sent template. */
  async propose(contractId: string, costVnd: number, studioId: string): Promise<Detailed> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await lockedContract(tx, contractId, studioId);
      assertContractStatus(contract, ContractStatus.SENT, 'fill in');
      await tx.contract.update({
        where: { id: contractId },
        data: {
          costVnd: BigInt(costVnd),
          proposedBy: ContractProposedBy.STUDIO,
          studioSignedAt: new Date(),
          status: ContractStatus.STUDIO_SIGNED,
        },
      });
      const proposed = await reloadContract(tx, contractId);
      await recordContractEvent(this.auditLog, tx, proposed, CONTENT_EVENT.CONTRACT_PROPOSED, null, { costVnd });
      await tellContractUpdate(
        this.notifications,
        tx,
        proposed,
        `Studio "${proposed.studio.name}" báo giá ${vnd(costVnd)} và đã ký, chờ Admin.`,
      );
      return proposed;
    });
  }

  /** Studio: agrees with the Admin's countered cost and signs, completing the contract. */
  async studioSign(contractId: string, studioId: string): Promise<Detailed> {
    return this.withMail(async (tx, mailIds) => {
      const contract = await lockedContract(tx, contractId, studioId);
      assertContractStatus(contract, ContractStatus.ADMIN_COUNTERED, 'sign');
      await tx.contract.update({
        where: { id: contractId },
        data: { status: ContractStatus.SIGNED, studioSignedAt: new Date() },
      });
      return this.complete(tx, contractId, null, mailIds);
    });
  }

  /** Studio: disagrees with the Admin's countered cost, proposes another and signs it. */
  async studioCounter(contractId: string, costVnd: number, studioId: string): Promise<Detailed> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await lockedContract(tx, contractId, studioId);
      assertContractStatus(contract, ContractStatus.ADMIN_COUNTERED, 'answer with another price');
      const next = await openNextRound(tx, contract, {
        costVnd: BigInt(costVnd),
        proposedBy: ContractProposedBy.STUDIO,
        status: ContractStatus.STUDIO_SIGNED,
        studioSignedAt: new Date(),
      });
      await recordContractEvent(this.auditLog, tx, next, CONTENT_EVENT.CONTRACT_COUNTERED, null, { costVnd });
      await tellContractUpdate(
        this.notifications,
        tx,
        next,
        `Studio "${next.studio.name}" đề xuất giá khác ${vnd(costVnd)} (đã ký), chờ Admin.`,
      );
      return next;
    });
  }

  /** Whether the hand-off has a fully signed round — the gate before it may move to IN_PROGRESS. */
  async isSigned(handoffId: string, tx?: PrismaTx): Promise<boolean> {
    const signed = await (tx ?? this.prisma).contract.count({ where: { handoffId, status: ContractStatus.SIGNED } });
    return signed > 0;
  }

  /** Both sides signed: the project is handed off to the studio and everyone is told. */
  private async complete(
    tx: PrismaTx,
    contractId: string,
    actorId: string | null,
    mailIds: (string | null)[],
  ): Promise<Detailed> {
    const signed = await reloadContract(tx, contractId);
    await this.handoffs.open(tx, signed);
    await recordContractEvent(this.auditLog, tx, signed, CONTENT_EVENT.CONTRACT_SIGNED, actorId, {
      costVnd: Number(signed.costVnd),
    });
    await tellContractUpdate(
      this.notifications,
      tx,
      signed,
      `Hợp đồng với studio "${signed.studio.name}" đã đủ chữ ký hai bên (${vnd(signed.costVnd!)}); Studio bắt đầu sản xuất.`,
    );
    const title = signed.project.movie.title;
    mailIds.push(
      await queueContractMail(
        this.mails,
        tx,
        signed,
        signed.adminSignedById ?? signed.createdById,
        `Hợp đồng phim "${title}" đã hoàn tất`,
        `/projects/${signed.projectId}`,
        [
          `Hợp đồng phim "${title}" đã đủ chữ ký hai bên, chi phí sản xuất ${vnd(signed.costVnd!)}.`,
          'Studio có thể bắt đầu sản xuất. Kịch bản Final và hạn giao từng tập nằm trên Studio Web.',
        ],
      ),
    );
    return reloadContract(tx, contractId);
  }

  /** Runs `work` in a transaction, then sends the emails it queued once they committed. */
  private async withMail<T>(work: (tx: PrismaTx, mailIds: (string | null)[]) => Promise<T>): Promise<T> {
    const mailIds: (string | null)[] = [];
    const result = await this.prisma.$transaction((tx) => work(tx, mailIds));
    await this.mails.dispatch(...mailIds);
    return result;
  }
}
