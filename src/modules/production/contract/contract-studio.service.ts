import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContractDocumentSide, ContractProposedBy, ContractStatus } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { assertLegalProfileComplete } from 'src/modules/production/studio/studio-legal-profile';
import { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import { ContractCompletionService, vnd } from './contract-completion.service';
import { ContractHandoffService } from './contract-handoff.service';
import { recordContractEvent, tellContractUpdate } from './contract-notice';
import {
  assertContractStatus,
  assertNewCost,
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
 * The studio side of the MF-1 negotiation: the studio signs the contract it was sent by uploading its signature
 * image (at the budget ceiling or a lower cost), then either signs the Admin's counter the same way — which
 * completes the round and renders the FINAL copy with both signatures — or answers with another price and its
 * signature. Signing needs a complete legal profile (22/11/2026). A studio only ever reaches its own rounds.
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
    private readonly handoffs: ContractHandoffService,
  ) {}

  /**
   * Every round sent to one studio, newest first (the studio's own view), each with its budget: the ceiling the
   * studio may quote up to while the round is open, the signed cost once it is closed.
   */
  async forStudio(studioId: string) {
    const rounds = await this.prisma.contract.findMany({
      where: { studioId },
      orderBy: [{ updatedAt: 'desc' }],
      include: CONTRACT_DETAIL,
    });
    return Promise.all(
      rounds.map(async (round) => ({ ...round, budgetVnd: await this.handoffs.budgetOf(this.prisma, round) })),
    );
  }

  /**
   * Studio: signs the contract it was sent with its signature image. Without a cost it signs at the value printed
   * on it, the budget ceiling; with one it proposes a lower cost. Either way the Admin countersigns next.
   */
  async propose(
    contractId: string,
    proposedVnd: number | undefined,
    actor: StudioActor,
    file?: Express.Multer.File,
  ): Promise<Detailed> {
    const round = await this.own(contractId, actor.studioId);
    assertContractStatus(round, ContractStatus.SENT, 'sign');
    const prepared = await this.prepare(round, file);
    return this.signing(prepared, async (tx) => {
      const contract = await lockedContract(tx, contractId, actor.studioId);
      assertContractStatus(contract, ContractStatus.SENT, 'sign');
      // The project row is locked, so the ceiling read here is the one the signed copy prints and stays fixed.
      const ceiling = await this.handoffs.ceiling(tx, contract.projectId, contract.handoffId);
      const costVnd = proposedVnd ?? ceiling;
      // Signing at the ceiling needs one: an unfunded or fully committed budget leaves nothing to sign for.
      if (costVnd <= 0) {
        throw new ConflictException({
          message: 'The project has no production budget left to sign this contract for; ask the Admin to add budget',
          details: { reason: 'NO_BUDGET_LEFT' },
        });
      }
      await this.handoffs.assertAffordable(tx, contract.projectId, costVnd, contract.handoffId);
      await tx.contract.update({
        where: { id: contractId },
        data: {
          costVnd: BigInt(costVnd),
          ceilingVnd: BigInt(ceiling),
          proposedBy: ContractProposedBy.STUDIO,
          studioSignedAt: prepared.signedAt,
          status: ContractStatus.STUDIO_SIGNED,
        },
      });
      await this.signatures.attach(tx, contractId, prepared, actor.userId, false);
      const proposed = await reloadContract(tx, contractId);
      await recordContractEvent(this.auditLog, tx, proposed, CONTENT_EVENT.CONTRACT_PROPOSED, null, { costVnd });
      await tellContractUpdate(
        this.notifications,
        tx,
        proposed,
        `Studio "${proposed.studio.name}" báo giá ${vnd(costVnd)} và đã ký hợp đồng, chờ Admin.`,
      );
      return proposed;
    });
  }

  /** Studio: agrees with the Admin's countered cost and signs with its signature image, completing the contract. */
  async studioSign(contractId: string, actor: StudioActor, file?: Express.Multer.File): Promise<Detailed> {
    const round = await this.own(contractId, actor.studioId);
    assertContractStatus(round, ContractStatus.ADMIN_COUNTERED, 'sign');
    await this.signatures.assertCounterpartSigned(this.prisma, contractId, ContractDocumentSide.STUDIO);
    const prepared = await this.prepare(round, file);
    return this.signing(prepared, async (tx, mailIds) => {
      const contract = await lockedContract(tx, contractId, actor.studioId);
      assertContractStatus(contract, ContractStatus.ADMIN_COUNTERED, 'sign');
      // Rendered while the round is still open, so the FINAL copy prints the same ceiling as the Admin's copy.
      await this.signatures.attach(tx, contractId, prepared, actor.userId, true);
      await tx.contract.update({
        where: { id: contractId },
        data: { status: ContractStatus.SIGNED, studioSignedAt: prepared.signedAt },
      });
      return this.completion.complete(tx, contractId, null, mailIds);
    });
  }

  /** Studio: disagrees with the Admin's countered cost, proposes another and signs it with its signature image. */
  async studioCounter(
    contractId: string,
    costVnd: number,
    actor: StudioActor,
    file?: Express.Multer.File,
  ): Promise<Detailed> {
    const round = await this.own(contractId, actor.studioId);
    assertContractStatus(round, ContractStatus.ADMIN_COUNTERED, 'answer with another price');
    assertNewCost(round, costVnd);
    const prepared = await this.prepare(round, file);
    return this.signing(prepared, async (tx) => {
      const contract = await lockedContract(tx, contractId, actor.studioId);
      assertContractStatus(contract, ContractStatus.ADMIN_COUNTERED, 'answer with another price');
      assertNewCost(contract, costVnd);
      await this.handoffs.assertAffordable(tx, contract.projectId, costVnd, contract.handoffId);
      const ceiling = await this.handoffs.ceiling(tx, contract.projectId, contract.handoffId);
      const opened = await openNextRound(tx, contract, {
        costVnd: BigInt(costVnd),
        ceilingVnd: BigInt(ceiling),
        proposedBy: ContractProposedBy.STUDIO,
        status: ContractStatus.STUDIO_SIGNED,
        studioSignedAt: prepared.signedAt,
      });
      await this.signatures.attach(tx, opened.id, prepared, actor.userId, false);
      const next = await reloadContract(tx, opened.id);
      await recordContractEvent(this.auditLog, tx, next, CONTENT_EVENT.CONTRACT_COUNTERED, null, { costVnd });
      await tellContractUpdate(
        this.notifications,
        tx,
        next,
        `Studio "${next.studio.name}" đề xuất giá khác ${vnd(costVnd)} và đã ký hợp đồng, chờ Admin.`,
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

  /** The studio signs only with a complete legal profile; the image is checked and stored before the transaction. */
  private async prepare(contract: Detailed, file?: Express.Multer.File): Promise<PreparedSignature> {
    await assertLegalProfileComplete(this.prisma, contract.studioId);
    return this.signatures.prepare(contract.projectId, ContractDocumentSide.STUDIO, file);
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
