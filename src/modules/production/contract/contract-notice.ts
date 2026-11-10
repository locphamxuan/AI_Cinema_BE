import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { ContentEvent } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import type { Detailed } from './contract-rounds';

/** The project team and the Admins follow the negotiation; the studio's accounts see their side of it. */
export async function tellContractUpdate(
  notifications: NotificationService,
  tx: PrismaTx,
  contract: Detailed,
  body: string,
): Promise<void> {
  const { project } = contract;
  const title = `Hợp đồng phim "${project.movie.title}" có cập nhật`;
  const payload = { projectId: project.id, contractId: contract.id };
  const admins = await notifications.adminIds(tx);
  const team = [project.reviewerId, project.creatorId, ...admins].filter((id): id is string => !!id);
  await notifications.notify(
    [...new Set(team)],
    { type: NOTIFICATION_TYPE.CONTRACT_UPDATED, title, body, link: `/projects/${project.id}/contract`, payload },
    tx,
  );
  await notifications.notify(
    await notifications.studioAccountIds(contract.studioId, tx),
    { type: NOTIFICATION_TYPE.CONTRACT_UPDATED, title, body, link: '/contracts', payload },
    tx,
  );
}

/** A content event of a contract round, in the project history. */
export function recordContractEvent(
  auditLog: AuditLogService,
  tx: PrismaTx,
  contract: { id: string; projectId: string },
  action: ContentEvent,
  actorId: string | null,
  payload: Record<string, unknown>,
) {
  return auditLog.record(
    { action, entityType: 'Contract', entityId: contract.id, projectId: contract.projectId, actorId, payload },
    tx,
  );
}

/** Queues an email to the studio of the contract inside the transaction; dispatch it once committed. */
export function queueContractMail(
  mails: StudioMailService,
  tx: PrismaTx,
  contract: Detailed,
  senderId: string,
  subject: string,
  portalPath: string,
  lines: string[],
): Promise<string | null> {
  return mails.queue(tx, {
    studioId: contract.studioId,
    senderId,
    subject: `[AI Cinema] ${subject}`,
    lines,
    portalPath,
    failureLink: `/projects/${contract.projectId}/contract`,
  });
}
