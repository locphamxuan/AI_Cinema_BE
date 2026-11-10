import { StudioMilestoneStatus as Milestone } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { AUTO_DELIVERED_NOTE, AUTO_REOPENED_NOTE, deliverOnSubmission, reopenOnChanges } from './deliver-on-submission';

const SUBMISSION = { handoffId: 'handoff', mediaAssetId: 'asset', projectId: 'movie', submittedById: 'studio-user' };

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
          changedById: 'studio-user',
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

describe('reopenOnChanges', () => {
  const change = { handoffId: 'handoff', projectId: 'movie', reviewerId: 'reviewer' };
  const setupReopen = (updated: number) => {
    const tx = {
      studioHandoff: { updateMany: jest.fn().mockResolvedValue({ count: updated }) },
      studioMilestoneEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    return { tx, auditLog, run: (c = change) => reopenOnChanges(tx as never, auditLog as never, c) };
  };

  it('moves a DELIVERED hand-off back to IN_PROGRESS when the Reviewer asks for changes', async () => {
    const { tx, auditLog, run } = setupReopen(1);
    await expect(run()).resolves.toBe(true);
    expect(tx.studioHandoff.updateMany).toHaveBeenCalledWith({
      where: { id: 'handoff', milestoneStatus: Milestone.DELIVERED },
      data: { milestoneStatus: Milestone.IN_PROGRESS, statusNote: AUTO_REOPENED_NOTE },
    });
    expect(tx.studioMilestoneEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: Milestone.DELIVERED, toStatus: Milestone.IN_PROGRESS }),
    });
    expect(auditLog.record).toHaveBeenCalled();
  });

  it('leaves a hand-off that is not DELIVERED, or a delivery without one, alone', async () => {
    const notDelivered = setupReopen(0);
    await expect(notDelivered.run()).resolves.toBe(false);
    expect(notDelivered.tx.studioMilestoneEvent.create).not.toHaveBeenCalled();
    const none = setupReopen(1);
    await expect(none.run({ ...change, handoffId: null as never })).resolves.toBe(false);
    expect(none.tx.studioHandoff.updateMany).not.toHaveBeenCalled();
  });
});
