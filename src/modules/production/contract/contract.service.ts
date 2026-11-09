import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContractProposedBy, ContractStatus, ProjectStatus, type Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT, type ContentEvent } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { PROJECT_REF } from 'src/modules/production/project-access/project-relations';
import { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import { ContractHandoffService } from './contract-handoff.service';

const PERSON = { select: { id: true, fullName: true } } as const;
const CONTRACT_DETAIL = {
  project: PROJECT_REF,
  studio: { select: { id: true, name: true } },
  handoff: { select: { id: true, milestoneStatus: true } },
  createdBy: PERSON,
  adminSignedBy: PERSON,
} satisfies Prisma.ContractInclude;

type Detailed = Prisma.ContractGetPayload<{ include: typeof CONTRACT_DETAIL }>;
type Project = Detailed['project'];

export interface SentTemplate {
  contract: Detailed;
  /** The email telling the studio; send it with StudioMailService.dispatch once the transaction committed. */
  mailId: string | null;
}

/** Rounds still being negotiated: a project has at most one at a time. */
const OPEN: ContractStatus[] = [ContractStatus.SENT, ContractStatus.STUDIO_SIGNED, ContractStatus.ADMIN_COUNTERED];

const STANDARD_TERMS =
  'Studio sản xuất đúng Kịch bản Final và tiến độ đã thống nhất; nền tảng có quyền yêu cầu chỉnh sửa nội dung trước khi nghiệm thu; Studio không chia sẻ phim cho bên thứ ba.';

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
    const open = await tx.contract.count({ where: { projectId, status: { in: [...OPEN, ContractStatus.SIGNED] } } });
    if (open) throw new ConflictException('This project already has a contract');
    const contract = await tx.contract.create({
      data: {
        projectId,
        studioId: project.studioId,
        terms: terms?.trim() || STANDARD_TERMS,
        createdById: actorId,
      },
      include: CONTRACT_DETAIL,
    });
    await this.record(tx, contract, CONTENT_EVENT.CONTRACT_SENT, actorId, { studioId: project.studioId });
    await this.tell(tx, contract, `Hợp đồng mẫu đã gửi cho studio "${contract.studio.name}", chờ Studio báo giá.`);
    const title = contract.project.movie.title;
    const mailId = await this.mail(
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
      const contract = await this.locked(tx, contractId);
      await this.access.project(contract.projectId, admin, 'read');
      this.assertStatus(contract, ContractStatus.STUDIO_SIGNED, 'countersign');
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
      const contract = await this.locked(tx, contractId);
      await this.access.project(contract.projectId, admin, 'read');
      this.assertStatus(contract, ContractStatus.STUDIO_SIGNED, 'counter');
      await this.handoffs.assertAffordable(tx, contract.projectId, costVnd);
      const next = await this.nextRound(tx, contract, {
        costVnd: BigInt(costVnd),
        proposedBy: ContractProposedBy.ADMIN,
        status: ContractStatus.ADMIN_COUNTERED,
        adminSignedAt: new Date(),
        adminSignedById: admin.id,
      });
      await this.record(tx, next, CONTENT_EVENT.CONTRACT_COUNTERED, admin.id, { costVnd });
      await this.tell(tx, next, `Admin đề xuất giá mới ${vnd(costVnd)} (đã ký), chờ studio "${next.studio.name}".`);
      const title = next.project.movie.title;
      mailIds.push(
        await this.mail(tx, next, admin.id, `Hợp đồng phim "${title}": Admin đề xuất chi phí mới`, '/contracts', [
          `Admin đề xuất chi phí sản xuất ${vnd(costVnd)} cho phim "${title}" và đã ký.`,
          'Vui lòng đăng nhập Studio Web để đồng ý và ký, hoặc đề xuất mức chi phí khác.',
        ]),
      );
      return next;
    });
  }

  /** Studio: fills in the cost and signs the freshly sent template. */
  async propose(contractId: string, costVnd: number, studioId: string): Promise<Detailed> {
    return this.prisma.$transaction(async (tx) => {
      const contract = await this.locked(tx, contractId, studioId);
      this.assertStatus(contract, ContractStatus.SENT, 'fill in');
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
      await this.tell(tx, proposed, `Studio "${proposed.studio.name}" báo giá ${vnd(costVnd)} và đã ký, chờ Admin.`);
      return proposed;
    });
  }

  /** Studio: agrees with the Admin's countered cost and signs, completing the contract. */
  async studioSign(contractId: string, studioId: string): Promise<Detailed> {
    return this.withMail(async (tx, mailIds) => {
      const contract = await this.locked(tx, contractId, studioId);
      this.assertStatus(contract, ContractStatus.ADMIN_COUNTERED, 'sign');
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
      const contract = await this.locked(tx, contractId, studioId);
      this.assertStatus(contract, ContractStatus.ADMIN_COUNTERED, 'answer with another price');
      const next = await this.nextRound(tx, contract, {
        costVnd: BigInt(costVnd),
        proposedBy: ContractProposedBy.STUDIO,
        status: ContractStatus.STUDIO_SIGNED,
        studioSignedAt: new Date(),
      });
      await this.record(tx, next, CONTENT_EVENT.CONTRACT_COUNTERED, null, { costVnd });
      await this.tell(tx, next, `Studio "${next.studio.name}" đề xuất giá khác ${vnd(costVnd)} (đã ký), chờ Admin.`);
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
    const signed = await this.reload(tx, contractId);
    await this.handoffs.open(tx, signed);
    await this.record(tx, signed, CONTENT_EVENT.CONTRACT_SIGNED, actorId, { costVnd: Number(signed.costVnd) });
    await this.tell(
      tx,
      signed,
      `Hợp đồng với studio "${signed.studio.name}" đã đủ chữ ký hai bên (${vnd(signed.costVnd!)}); Studio bắt đầu sản xuất.`,
    );
    const title = signed.project.movie.title;
    mailIds.push(
      await this.mail(
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
    return this.reload(tx, contractId);
  }

  /** Runs `work` in a transaction, then sends the emails it queued once they committed. */
  private async withMail<T>(work: (tx: PrismaTx, mailIds: (string | null)[]) => Promise<T>): Promise<T> {
    const mailIds: (string | null)[] = [];
    const result = await this.prisma.$transaction((tx) => work(tx, mailIds));
    await this.mails.dispatch(...mailIds);
    return result;
  }

  private mail(
    tx: PrismaTx,
    contract: Detailed,
    senderId: string,
    subject: string,
    portalPath: string,
    lines: string[],
  ): Promise<string | null> {
    return this.mails.queue(tx, {
      studioId: contract.studioId,
      senderId,
      subject: `[AI Cinema] ${subject}`,
      lines,
      portalPath,
      failureLink: `/projects/${contract.projectId}/contract`,
    });
  }

  private assertStatus(contract: Detailed, expected: ContractStatus, action: string): void {
    if (contract.status !== expected) {
      throw new ConflictException(`Cannot ${action} a contract that is ${contract.status} (expected ${expected})`);
    }
  }

  /** The contract, row-locked, so a double click cannot answer the same round twice; a studio sees only its own. */
  private async locked(tx: PrismaTx, contractId: string, studioId?: string): Promise<Detailed> {
    const found = await tx.contract.findUnique({ where: { id: contractId }, select: { id: true, studioId: true } });
    if (!found || (studioId && found.studioId !== studioId)) throw new NotFoundException('Contract not found');
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
    return tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: CONTRACT_DETAIL });
  }

  private reload(tx: PrismaTx, contractId: string): Promise<Detailed> {
    return tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: CONTRACT_DETAIL });
  }

  /** Closes the current round (SUPERSEDED) and opens the next one with the new proposal. */
  private async nextRound(
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

  /** The project team and the Admins follow the negotiation; the studio's accounts see their side of it. */
  private async tell(tx: PrismaTx, contract: Detailed, body: string): Promise<void> {
    const project: Project = contract.project;
    const title = `Hợp đồng phim "${project.movie.title}" có cập nhật`;
    const payload = { projectId: project.id, contractId: contract.id };
    const admins = await this.notifications.adminIds(tx);
    const team = [project.reviewerId, project.creatorId, ...admins].filter((id): id is string => !!id);
    await this.notifications.notify(
      [...new Set(team)],
      { type: NOTIFICATION_TYPE.CONTRACT_UPDATED, title, body, link: `/projects/${project.id}/contract`, payload },
      tx,
    );
    await this.notifications.notify(
      await this.notifications.studioAccountIds(contract.studioId, tx),
      { type: NOTIFICATION_TYPE.CONTRACT_UPDATED, title, body, link: '/contracts', payload },
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
