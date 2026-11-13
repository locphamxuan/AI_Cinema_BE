import { Injectable, NotFoundException } from '@nestjs/common';
import { ContractDocumentSide, ContractProposedBy, ContractStatus } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import { ContractCompletionService, vnd } from './contract-completion.service';
import { recordContractEvent, tellContractUpdate } from './contract-notice';
import {
  assertContractStatus,
  CONTRACT_DETAIL,
  lockedContract,
  openNextRound,
  reloadContract,
  type Detailed,
} from './contract-rounds';
import { ContractSignatureService, type PreparedSignature } from './contract-signature.service';

/** The studio account acting: which studio it speaks for, and who is actually uploading. */
export interface StudioActor {
  studioId: string;
  userId: string;
}

/**
 * The studio side of the MF-1 negotiation (10/11/2026): the studio fills the cost into the template and
 * uploads the contract PDF carrying its signature, then either signs the Admin's counter the same way —
 * which completes the round and merges both counterparts — or answers with another price and its own signed
 * PDF. A studio only ever reaches its own rounds.
 */
@Injectable()
export class StudioContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signatures: ContractSignatureService,
    private readonly completion: ContractCompletionService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
    private readonly mails: StudioMailService,
  ) {}

  /** Every round sent to one studio, newest first (the studio's own view). */
  forStudio(studioId: string) {
    return this.prisma.contract.findMany({
      where: { studioId },
      orderBy: [{ updatedAt: 'desc' }],
      include: CONTRACT_DETAIL,
    });
  }

  /** Studio: fills in the cost of the freshly sent template and uploads its signed PDF of it. */
  async propose(
    contractId: string,
    costVnd: number,
    actor: StudioActor,
    file?: Express.Multer.File,
  ): Promise<Detailed> {
    const round = await this.own(contractId, actor.studioId);
    assertContractStatus(round, ContractStatus.SENT, 'fill in');
    const prepared = await this.prepare(round, false, BigInt(costVnd), file);
    return this.signing(prepared, async (tx) => {
      const contract = await lockedContract(tx, contractId, actor.studioId);
      assertContractStatus(contract, ContractStatus.SENT, 'fill in');
      await tx.contract.update({
        where: { id: contractId },
        data: {
          costVnd: BigInt(costVnd),
          proposedBy: ContractProposedBy.STUDIO,
          studioSignedAt: prepared.signedAt,
          status: ContractStatus.STUDIO_SIGNED,
        },
      });
      await this.signatures.attach(tx, contractId, prepared, actor.userId);
      const proposed = await reloadContract(tx, contractId);
      await recordContractEvent(this.auditLog, tx, proposed, CONTENT_EVENT.CONTRACT_PROPOSED, null, { costVnd });
      await tellContractUpdate(
        this.notifications,
        tx,
        proposed,
        `Studio "${proposed.studio.name}" báo giá ${vnd(costVnd)} và đã tải lên bản hợp đồng có chữ ký, chờ Admin.`,
      );
      return proposed;
    });
  }

  /** Studio: agrees with the Admin's countered cost and uploads its signed PDF, completing the contract. */
  async studioSign(contractId: string, actor: StudioActor, file?: Express.Multer.File): Promise<Detailed> {
    const round = await this.own(contractId, actor.studioId);
    assertContractStatus(round, ContractStatus.ADMIN_COUNTERED, 'sign');
    const prepared = await this.prepare(round, true, round.costVnd, file);
    return this.signing(prepared, async (tx, mailIds) => {
      const contract = await lockedContract(tx, contractId, actor.studioId);
      assertContractStatus(contract, ContractStatus.ADMIN_COUNTERED, 'sign');
      await tx.contract.update({
        where: { id: contractId },
        data: { status: ContractStatus.SIGNED, studioSignedAt: prepared.signedAt },
      });
      await this.signatures.attach(tx, contractId, prepared, actor.userId);
      return this.completion.complete(tx, contractId, null, mailIds);
    });
  }

  /** Studio: disagrees with the Admin's countered cost, proposes another and uploads its signed PDF of it. */
  async studioCounter(
    contractId: string,
    costVnd: number,
    actor: StudioActor,
    file?: Express.Multer.File,
  ): Promise<Detailed> {
    const round = await this.own(contractId, actor.studioId);
    assertContractStatus(round, ContractStatus.ADMIN_COUNTERED, 'answer with another price');
    const prepared = await this.prepare(round, false, BigInt(costVnd), file);
    return this.signing(prepared, async (tx) => {
      const contract = await lockedContract(tx, contractId, actor.studioId);
      assertContractStatus(contract, ContractStatus.ADMIN_COUNTERED, 'answer with another price');
      const opened = await openNextRound(tx, contract, {
        costVnd: BigInt(costVnd),
        proposedBy: ContractProposedBy.STUDIO,
        status: ContractStatus.STUDIO_SIGNED,
        studioSignedAt: prepared.signedAt,
      });
      await this.signatures.attach(tx, opened.id, prepared, actor.userId);
      const next = await reloadContract(tx, opened.id);
      await recordContractEvent(this.auditLog, tx, next, CONTENT_EVENT.CONTRACT_COUNTERED, null, { costVnd });
      await tellContractUpdate(
        this.notifications,
        tx,
        next,
        `Studio "${next.studio.name}" đề xuất giá khác ${vnd(costVnd)} kèm bản hợp đồng đã ký, chờ Admin.`,
      );
      return next;
    });
  }

  /** The studio's own round, or 404: ids of other studios' contracts reveal nothing. */
  private async own(contractId: string, studioId: string): Promise<Detailed> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, studioId },
      include: CONTRACT_DETAIL,
    });
    if (!contract) throw new NotFoundException('Contract not found');
    return contract;
  }

  private prepare(
    contract: Detailed,
    completes: boolean,
    costVnd: bigint | null,
    file?: Express.Multer.File,
  ): Promise<PreparedSignature> {
    return this.signatures.prepare(
      { contract, side: ContractDocumentSide.STUDIO, completes, signerName: contract.studio.name, costVnd },
      file,
      this.prisma,
    );
  }

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
