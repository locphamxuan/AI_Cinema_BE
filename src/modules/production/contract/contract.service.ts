import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContractDocumentSide, ContractProposedBy, ContractStatus, ProjectStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertLegalProfileComplete } from 'src/modules/production/studio/studio-legal-profile';
import { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import { ContractCompletionService, vnd } from './contract-completion.service';
import { ContractHandoffService } from './contract-handoff.service';
import { assertStudioCanSign } from './studio-login';
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
import { ContractSignatureService, type PreparedSignature } from './contract-signature.service';

export interface SentTemplate {
  contract: Detailed;
  /** The email telling the studio; send it with StudioMailService.dispatch once the transaction committed. */
  mailId: string | null;
}

/**
 * MF-1 §3–4 contract negotiation: once the Admin approves the Final Script the system sends the project's studio
 * the unsigned contract (round 1); the studio signs it by uploading its signature image, at the budget ceiling or
 * a lower cost, then the Admin uploads its own signature image to agree (`sign`) or counter-proposes a new cost
 * with it (`counter`), which opens a new round. Each signature is drawn into the same contract template (since
 * 22/11/2026); a round is complete once both are in and the FINAL copy carrying them is rendered, which hands
 * the project off to the studio.
 * The studio side of the same negotiation lives in StudioContractService.
 */
/** The rounds the Admin may answer with a signed offer: the studio's signed cost, or the unanswered template. */
const ADMIN_OFFER_FROM = [ContractStatus.STUDIO_SIGNED, ContractStatus.SENT];

@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly handoffs: ContractHandoffService,
    private readonly signatures: ContractSignatureService,
    private readonly completion: ContractCompletionService,
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
    const ceiling = await this.handoffs.ceiling(tx, projectId, contract.handoffId);
    const mailId = await queueContractMail(
      this.mails,
      tx,
      contract,
      actorId,
      `Hợp đồng phim "${title}": mời Studio báo giá`,
      '/contracts',
      [
        `Kịch bản Final của phim "${title}" đã được duyệt và hợp đồng mẫu đã sẵn sàng.`,
        `Ngân sách trần cho hợp đồng: ${vnd(ceiling)}. Chi phí Studio đề xuất không được vượt mức này.`,
        'Vui lòng đăng nhập Studio Web, hoàn thiện hồ sơ pháp lý của Studio (nếu chưa có), tải bản hợp đồng chưa ký ' +
          '(đã điền thông tin dự án và ngân sách trần) để kiểm tra, rồi tải lên ảnh chữ ký để ký hợp đồng.',
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
    const studio = await tx.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } });
    await assertStudioCanSign(tx, studioId, studio.name);
    const contract = await tx.contract.create({
      data: { projectId, studioId, handoffId, terms: terms?.trim() || STANDARD_TERMS, createdById: actorId },
      include: CONTRACT_DETAIL,
    });
    await recordContractEvent(this.auditLog, tx, contract, CONTENT_EVENT.CONTRACT_SENT, actorId, { studioId });
    const body = `Hợp đồng mẫu đã gửi cho studio "${contract.studio.name}", chờ Studio báo giá và ký.`;
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
    // After a studio change two studios each have a round 1: order by time first so the list is stable.
    return this.prisma.contract.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }, { round: 'asc' }],
      include: CONTRACT_DETAIL,
    });
  }

  /**
   * Admin agrees with the cost the studio proposed and uploads AI Cinema's signature image: the round now holds
   * both signatures, the system renders the FINAL copy with them and the project is handed off.
   */
  async sign(contractId: string, admin: AuthenticatedUser, file?: Express.Multer.File): Promise<Detailed> {
    const round = await this.readable(contractId, admin);
    assertContractStatus(round, ContractStatus.STUDIO_SIGNED, 'countersign');
    const prepared = await this.signatures.prepare(round.projectId, ContractDocumentSide.ADMIN, file);
    return this.signing(prepared, async (tx, mailIds) => {
      const contract = await lockedContract(tx, contractId);
      assertContractStatus(contract, ContractStatus.STUDIO_SIGNED, 'countersign');
      // Rendered while the round is still open, so the FINAL copy prints the same ceiling as the studio's copy.
      await this.signatures.attach(tx, contractId, prepared, admin.id, true);
      await tx.contract.update({
        where: { id: contractId },
        data: { status: ContractStatus.SIGNED, adminSignedAt: prepared.signedAt, adminSignedById: admin.id },
      });
      return this.completion.complete(tx, contractId, admin.id, mailIds);
    });
  }

  /**
   * The Admin signs the contract for a new cost with AI Cinema's signature image, which opens a new round the
   * studio answers with its own signature. Works on the studio's offer (a counter) and, for the order "Admin
   * signs first", straight on the template the studio has not answered yet.
   */
  async counter(
    contractId: string,
    costVnd: number,
    admin: AuthenticatedUser,
    file?: Express.Multer.File,
  ): Promise<Detailed> {
    const round = await this.readable(contractId, admin);
    assertContractStatus(round, ADMIN_OFFER_FROM, 'counter');
    // The copy the Admin signs prints Bên B: it must be complete before anyone signs.
    await assertLegalProfileComplete(this.prisma, round.studioId);
    const prepared = await this.signatures.prepare(round.projectId, ContractDocumentSide.ADMIN, file);
    return this.signing(prepared, async (tx, mailIds) => {
      const contract = await lockedContract(tx, contractId);
      assertContractStatus(contract, ADMIN_OFFER_FROM, 'counter');
      await this.handoffs.assertAffordable(tx, contract.projectId, costVnd, contract.handoffId);
      const opened = await openNextRound(tx, contract, {
        costVnd: BigInt(costVnd),
        proposedBy: ContractProposedBy.ADMIN,
        status: ContractStatus.ADMIN_COUNTERED,
        adminSignedAt: prepared.signedAt,
        adminSignedById: admin.id,
      });
      await this.signatures.attach(tx, opened.id, prepared, admin.id, false);
      const next = await reloadContract(tx, opened.id);
      await recordContractEvent(this.auditLog, tx, next, CONTENT_EVENT.CONTRACT_COUNTERED, admin.id, { costVnd });
      await tellContractUpdate(
        this.notifications,
        tx,
        next,
        `Admin đề xuất giá mới ${vnd(costVnd)} và đã ký hợp đồng, chờ studio "${next.studio.name}".`,
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
            `Admin đề xuất chi phí sản xuất ${vnd(costVnd)} cho phim "${title}" và đã ký hợp đồng thay mặt AI Cinema.`,
            'Vui lòng đăng nhập Studio Web để xem bản hợp đồng Admin đã ký, rồi tải lên ảnh chữ ký của Studio để ký, hoặc đề xuất mức chi phí khác.',
          ],
        ),
      );
      return next;
    });
  }

  /** Whether the hand-off has a fully signed round — the gate before it may move to IN_PROGRESS. */
  async isSigned(handoffId: string, tx?: PrismaTx): Promise<boolean> {
    const signed = await (tx ?? this.prisma).contract.count({ where: { handoffId, status: ContractStatus.SIGNED } });
    return signed > 0;
  }

  /** The round as the Admin sees it, before anything is stored: 404 unless the caller may read the project. */
  private async readable(contractId: string, user: AuthenticatedUser): Promise<Detailed> {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId }, include: CONTRACT_DETAIL });
    if (!contract) throw new NotFoundException('Contract not found');
    await this.access.project(contract.projectId, user, 'read');
    return contract;
  }

  /**
   * The signing transaction: emails it queued go out once it committed, and a failure takes back the signature
   * image and the copies already written to storage, so no object is ever left without its row.
   */
  private async signing<T>(
    prepared: PreparedSignature,
    work: (tx: PrismaTx, mailIds: (string | null)[]) => Promise<T>,
  ): Promise<T> {
    const mailIds: (string | null)[] = [];
    try {
      const result = await this.prisma.$transaction((tx) => work(tx, mailIds));
      await this.mails.dispatch(...mailIds);
      return result;
    } catch (error) {
      await this.signatures.discard(prepared);
      throw error;
    }
  }
}
