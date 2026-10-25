import { StudioMilestoneStatus as Milestone } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { AUTO_DELIVERED_NOTE, deliverOnSubmission } from './deliver-on-submission';

const SUBMISSION = { handoffId: 'handoff', mediaAssetId: 'asset', movieId: 'movie', submittedById: 'creator' };

function setup(milestoneStatus: Milestone | null, updated = 1) {
  const tx = {
    studioHandoff: {
      findUnique: jest.fn().mockResolvedValue(milestoneStatus && { milestoneStatus, respondedAt: null }),
      updateMany: jest.fn().mockResolvedValue({ count: updated }),
    },
    studioMilestoneEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  const run = () => deliverOnSubmission(tx as unknown as PrismaTx, auditLog as unknown as AuditLogService, SUBMISSION);
  return { tx, auditLog, run };
}

describe('deliverOnSubmission', () => {
  it.each([Milestone.BRIEF_SENT, Milestone.STUDIO_ACCEPTED, Milestone.IN_PROGRESS])(
    'moves a hand-off at %s to DELIVERED with the Submission',
    async (from) => {
      const { tx, auditLog, run } = setup(from);

      await expect(run()).resolves.toBe(from);

      expect(tx.studioHandoff.updateMany).toHaveBeenCalledWith({
        where: { id: 'handoff', milestoneStatus: from },
        data: expect.objectContaining({ milestoneStatus: Milestone.DELIVERED, statusNote: AUTO_DELIVERED_NOTE }),
      });
      expect(tx.studioMilestoneEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fromStatus: from,
          toStatus: Milestone.DELIVERED,
          mediaAssetId: 'asset',
          changedById: 'creator',
        }),
      });
      expect(auditLog.record).toHaveBeenCalledTimes(1);
    },
  );

  it.each([Milestone.DELIVERED, Milestone.STUDIO_DECLINED, Milestone.SUPERSEDED])(
    'leaves a hand-off at %s alone',
    async (from) => {
      const { tx, auditLog, run } = setup(from);

      await expect(run()).resolves.toBeNull();

      expect(tx.studioHandoff.updateMany).not.toHaveBeenCalled();
      expect(tx.studioMilestoneEvent.create).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    },
  );

  it('records nothing when the hand-off changed meanwhile', async () => {
    const { tx, run } = setup(Milestone.IN_PROGRESS, 0);

    await expect(run()).resolves.toBeNull();

    expect(tx.studioMilestoneEvent.create).not.toHaveBeenCalled();
  });
});
