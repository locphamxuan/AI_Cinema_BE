import { StudioMilestoneStatus as Milestone } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';

/** Milestones a Submission moves straight to DELIVERED: the studio's film has come back by email. */
const AWAITING_FILM: Milestone[] = [Milestone.BRIEF_SENT, Milestone.STUDIO_ACCEPTED, Milestone.IN_PROGRESS];

export const AUTO_DELIVERED_NOTE = 'Tự chuyển sang "Studio đã giao" khi Submission xử lý xong.';

/**
 * BR-58: a Submission that is READY to review is what proves the studio delivered, so the hand-off is marked
 * DELIVERED with that Submission instead of waiting for the Creator to step through every milestone by hand. A
 * hand-off already DELIVERED, declined or superseded is left alone. Returns the milestone it moved from, or null.
 */
export async function deliverOnSubmission(
  tx: PrismaTx,
  auditLog: AuditLogService,
  submission: { handoffId: string; mediaAssetId: string; projectId: string; submittedById: string },
): Promise<Milestone | null> {
  const handoff = await tx.studioHandoff.findUnique({
    where: { id: submission.handoffId },
    select: { milestoneStatus: true, respondedAt: true },
  });
  if (!handoff || !AWAITING_FILM.includes(handoff.milestoneStatus)) return null;

  const from = handoff.milestoneStatus;
  const { count } = await tx.studioHandoff.updateMany({
    where: { id: submission.handoffId, milestoneStatus: from },
    data: {
      milestoneStatus: Milestone.DELIVERED,
      statusNote: AUTO_DELIVERED_NOTE,
      ...(handoff.respondedAt ? {} : { respondedAt: new Date() }),
    },
  });
  if (count === 0) return null;
  await tx.studioMilestoneEvent.create({
    data: {
      handoffId: submission.handoffId,
      fromStatus: from,
      toStatus: Milestone.DELIVERED,
      note: AUTO_DELIVERED_NOTE,
      mediaAssetId: submission.mediaAssetId,
      changedById: submission.submittedById,
    },
  });
  await auditLog.record(
    {
      action: CONTENT_EVENT.STUDIO_MILESTONE_UPDATED,
      entityType: 'StudioHandoff',
      entityId: submission.handoffId,
      projectId: submission.projectId,
      actorId: submission.submittedById,
      payload: { from, to: Milestone.DELIVERED, mediaAssetId: submission.mediaAssetId, auto: true },
    },
    tx,
  );
  return from;
}
