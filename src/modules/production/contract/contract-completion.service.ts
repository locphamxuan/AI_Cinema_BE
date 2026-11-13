import { Injectable } from '@nestjs/common';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import { ContractHandoffService } from './contract-handoff.service';
import { queueContractMail, recordContractEvent, tellContractUpdate } from './contract-notice';
import { reloadContract, type Detailed } from './contract-rounds';

export const vnd = (amount: number | bigint) => `${new Intl.NumberFormat('vi-VN').format(amount)} VND`;

/**
 * The end of a negotiation: the round carries both signed PDFs and the merged final document, so the project
 * is handed off to the studio, the event is recorded and both sides are told. Split out of ContractService so
 * the Admin and studio sides of the flow share exactly one completion path.
 */
@Injectable()
export class ContractCompletionService {
  constructor(
    private readonly handoffs: ContractHandoffService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
    private readonly mails: StudioMailService,
  ) {}

  async complete(
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
      `Hợp đồng với studio "${signed.studio.name}" đã đủ chữ ký hai bên (${vnd(signed.costVnd!)}); bản PDF ghép đủ hai chữ ký đã sẵn sàng, Studio bắt đầu sản xuất.`,
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
          'Bản PDF hợp đồng mang đủ hai chữ ký đã được hệ thống ghép và có thể tải về trên Studio Web.',
          'Studio có thể bắt đầu sản xuất. Kịch bản Final và hạn giao từng tập nằm trên Studio Web.',
        ],
      ),
    );
    return reloadContract(tx, contractId);
  }
}
