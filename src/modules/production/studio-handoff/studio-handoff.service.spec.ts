import { Readable } from 'node:stream';
import { ConflictException, NotFoundException, StreamableFile } from '@nestjs/common';
import { ProjectStatus, StudioMilestoneStatus, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { EMAIL_TEMPLATE } from 'src/modules/platform/email/email-outbox.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ContractService } from 'src/modules/production/contract/contract.service';
import type { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import type { StudioService } from 'src/modules/production/studio/studio.service';
import type { BriefService } from './brief/brief.service';
import { StudioHandoffService } from './studio-handoff.service';

const ADMIN = { id: 'admin', role: UserRole.ADMIN };
const PROJECT = { id: 'p1', status: ProjectStatus.IN_PRODUCTION, reviewerId: 'rev', movie: { title: 'Phim' } };
const STUDIO = { id: 'st2', name: 'Lumen' };
const DTO = { reason: ' Trễ hạn ', offeredFeeVnd: 30_000_000, forfeitedVnd: 5_000_000 };
const BRIEF = { subject: 'Brief', lines: ['a'], attachments: [], offeredFeeVnd: 30_000_000, briefKey: 'briefs/1.pdf' };
const OLD = { id: 'h1', offeredFeeVnd: 20_000_000n, milestoneStatus: StudioMilestoneStatus.IN_PROGRESS };

describe('StudioHandoffService', () => {
  const db = {
    studioHandoff: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    studioMilestoneEvent: { createMany: jest.fn() },
    movieProject: { update: jest.fn() },
    season: { findFirst: jest.fn() },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn() };
  const studios = { resolve: jest.fn() };
  const costs = { summary: jest.fn(), assertAffordable: jest.fn() };
  const briefs = { prepare: jest.fn() };
  const mails = { queue: jest.fn(), dispatch: jest.fn() };
  const contracts = { sendForStudioChange: jest.fn() };
  const storage = { stream: jest.fn() };
  const auditLog = { record: jest.fn() };
  const notifications = { notify: jest.fn() };
  const service = new StudioHandoffService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    studios as unknown as StudioService,
    costs as unknown as ProductionCostService,
    briefs as unknown as BriefService,
    mails as unknown as StudioMailService,
    storage as unknown as ObjectStorage,
    auditLog as unknown as AuditLogService,
    notifications as unknown as NotificationService,
    contracts as unknown as ContractService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.project.mockResolvedValue(PROJECT);
    studios.resolve.mockResolvedValue(STUDIO);
    db.studioHandoff.findMany.mockResolvedValue([OLD]);
    db.studioHandoff.create.mockResolvedValue({ id: 'h2' });
    costs.summary.mockResolvedValue({ remainingVnd: 20_000_000 });
    briefs.prepare.mockResolvedValue(BRIEF);
    mails.queue.mockResolvedValue('mail-1');
  });

  describe('changeStudio', () => {
    it('supersedes the old hand-off, records the new one and mails the brief after commit', async () => {
      db.studioHandoff.findMany.mockResolvedValueOnce([OLD]).mockResolvedValueOnce([{ id: 'h2' }]);

      await expect(service.changeStudio('p1', DTO as never, ADMIN)).resolves.toEqual([{ id: 'h2' }]);

      expect(db.studioHandoff.findMany).toHaveBeenNthCalledWith(1, {
        where: { projectId: 'p1', seasonId: null, milestoneStatus: { not: StudioMilestoneStatus.SUPERSEDED } },
      });
      expect(db.studioHandoff.update).toHaveBeenCalledWith({
        where: { id: 'h1' },
        data: { milestoneStatus: StudioMilestoneStatus.SUPERSEDED, forfeitedVnd: 5_000_000n },
      });
      expect(db.studioMilestoneEvent.createMany).toHaveBeenCalledWith({
        data: [
          {
            handoffId: 'h1',
            fromStatus: StudioMilestoneStatus.IN_PROGRESS,
            toStatus: StudioMilestoneStatus.SUPERSEDED,
            note: 'Trễ hạn',
            changedById: 'admin',
          },
        ],
      });
      expect(db.movieProject.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { studioId: 'st2' } });
      expect(costs.assertAffordable).toHaveBeenCalledWith(db, 'p1', 30_000_000);
      expect(mails.queue).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ studioId: 'st2', senderId: 'admin', template: EMAIL_TEMPLATE.STUDIO_BRIEF }),
      );
      expect(db.studioHandoff.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'p1',
          studioId: 'st2',
          seasonId: null,
          offeredFeeVnd: 30_000_000n,
          changeReason: 'Trễ hạn',
          briefFileKey: 'briefs/1.pdf',
        }),
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: CONTENT_EVENT.STUDIO_CHANGED,
          entityId: 'h2',
          payload: expect.objectContaining({ forfeitedVnd: 5_000_000 }),
        }),
        db,
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        ['rev'],
        expect.objectContaining({ type: NOTIFICATION_TYPE.STUDIO_HANDOFF_SENT }),
        db,
      );
      expect(contracts.sendForStudioChange).toHaveBeenCalledWith(db, {
        projectId: 'p1',
        studioId: 'st2',
        handoffId: 'h2',
        actorId: 'admin',
      });
      // The brief invites the new studio to sign on Studio Web; production waits for the signature.
      const [, mail] = mails.queue.mock.calls[0] as [unknown, { portalPath: string; lines: string[] }];
      expect(mail.portalPath).toBe('/contracts');
      expect(mail.lines.at(-1)).toMatch(/ký/);
      expect(contracts.sendForStudioChange.mock.invocationCallOrder[0]).toBeLessThan(
        mails.queue.mock.invocationCallOrder[0],
      );
      expect(db.studioHandoff.update).toHaveBeenCalledWith({ where: { id: 'h2' }, data: { emailMessageId: 'mail-1' } });
      expect(mails.dispatch).toHaveBeenCalledWith('mail-1');
    });

    it('scopes to one season when asked, and treats no forfeit as zero', async () => {
      db.season.findFirst.mockResolvedValue({ id: 's1' });
      await service.changeStudio('p1', { reason: 'x', offeredFeeVnd: 1_000_000, seasonId: 's1' }, ADMIN);
      expect(briefs.prepare).toHaveBeenCalledWith('p1', STUDIO, 's1', { senderId: 'admin', offeredFeeVnd: 1_000_000 });
      expect(db.studioHandoff.update).toHaveBeenCalledWith({
        where: { id: 'h1' },
        data: expect.objectContaining({ forfeitedVnd: 0n }),
      });
    });

    it('counts what the old studio gives back when checking the budget', async () => {
      // 10M left + 20M offered - 5M kept = 25M available, less than the 30M fee.
      costs.summary.mockResolvedValue({ remainingVnd: 10_000_000 });
      await expect(service.changeStudio('p1', DTO as never, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      expect(briefs.prepare).not.toHaveBeenCalled();
    });

    it('refuses a project not in delivery, a scope with no hand-off and an unknown season', async () => {
      db.studioHandoff.findMany.mockResolvedValue([]);
      await expect(service.changeStudio('p1', DTO as never, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      db.season.findFirst.mockResolvedValue(null);
      await expect(service.changeStudio('p1', { ...DTO, seasonId: 's9' }, ADMIN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.ASSIGNED });
      await expect(service.changeStudio('p1', DTO as never, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not mail anything when the transaction fails', async () => {
      costs.assertAffordable.mockRejectedValueOnce(new ConflictException('over budget'));
      await expect(service.changeStudio('p1', DTO as never, ADMIN)).rejects.toThrow('over budget');
      expect(mails.dispatch).not.toHaveBeenCalled();
    });
  });

  it('reads the history newest first after checking access', async () => {
    await service.history('p1', ADMIN);
    expect(access.project).toHaveBeenCalledWith('p1', ADMIN, 'read');
    expect(db.studioHandoff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1' }, orderBy: { createdAt: 'desc' } }),
    );
  });

  describe('briefFile', () => {
    it('streams the stored PDF', async () => {
      db.studioHandoff.findFirst.mockResolvedValue({ briefFileKey: 'briefs/1.pdf' });
      storage.stream.mockResolvedValue(Readable.from('x'));
      const file = await service.briefFile('p1', 'h1', ADMIN);
      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.getHeaders()).toMatchObject({
        type: 'application/pdf',
        disposition: 'attachment; filename="brief-p1.pdf"',
      });
      expect(storage.stream).toHaveBeenCalledWith('briefs/1.pdf', 'private');
    });

    it('answers 404 for an unknown hand-off or one without a brief', async () => {
      db.studioHandoff.findFirst.mockResolvedValue(null);
      await expect(service.briefFile('p1', 'x', ADMIN)).rejects.toBeInstanceOf(NotFoundException);
      db.studioHandoff.findFirst.mockResolvedValue({ briefFileKey: null });
      await expect(service.briefFile('p1', 'h1', ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
