import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ProjectStatus, UserRole } from '@prisma/client';
import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ProjectTeamService } from './project-team.service';

const REVIEWER = { id: 'rev', role: UserRole.CONTENT_REVIEWER };
const LEAD = { id: 'lead', role: UserRole.CONTENT_CREATOR };
const SECOND = { id: 'second', role: UserRole.CONTENT_CREATOR };
const PROJECT = {
  id: 'p1',
  status: ProjectStatus.IN_PRODUCTION,
  reviewerId: 'rev',
  creatorId: 'lead',
  movie: { title: 'Phim' },
};

describe('ProjectTeamService', () => {
  const db = {
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    projectCreatorAssignment: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    episode: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn(), episode: jest.fn(), isOnTeam: jest.fn() };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new ProjectTeamService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );
  const actions = () => auditLog.record.mock.calls.map(([event]) => (event as { action: string }).action);

  beforeEach(() => {
    jest.clearAllMocks();
    access.project.mockResolvedValue(PROJECT);
    db.user.findUnique.mockResolvedValue({ role: UserRole.CONTENT_CREATOR, isActive: true });
    db.projectCreatorAssignment.findMany.mockResolvedValue([]);
    db.projectCreatorAssignment.findFirst.mockResolvedValue(null);
    db.projectCreatorAssignment.updateMany.mockResolvedValue({ count: 1 });
    db.episode.findMany.mockResolvedValue([]);
  });

  it('lists the active Creators one can pick from', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'c1' }]);
    await expect(service.directory()).resolves.toEqual([{ id: 'c1' }]);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: UserRole.CONTENT_CREATOR, isActive: true } }),
    );
  });

  it('shows each seat with its lead flag and the episodes that Creator holds', async () => {
    db.projectCreatorAssignment.findMany.mockResolvedValue([{ creatorId: 'lead' }, { creatorId: 'second' }]);
    db.episode.findMany.mockResolvedValue([
      { id: 'e1', assignedCreatorId: 'second' },
      { id: 'e2', assignedCreatorId: 'gone' },
    ]);
    await expect(service.list('p1', LEAD)).resolves.toEqual([
      { creatorId: 'lead', isLead: true, episodes: [] },
      { creatorId: 'second', isLead: false, episodes: [{ id: 'e1', assignedCreatorId: 'second' }] },
    ]);
  });

  describe('addCreator', () => {
    it('seats the Creator, audits it and tells them', async () => {
      await service.addCreator('p1', { creatorId: 'second', note: 'Hỗ trợ' }, REVIEWER);
      expect(db.projectCreatorAssignment.create).toHaveBeenCalledWith({
        data: { projectId: 'p1', creatorId: 'second', assignedById: 'rev', note: 'Hỗ trợ' },
      });
      expect(actions()).toEqual([CONTENT_EVENT.CREATOR_ADDED]);
      expect(notifications.notify).toHaveBeenCalledWith(
        ['second'],
        expect.objectContaining({ type: NOTIFICATION_TYPE.PROJECT_ASSIGNED }),
        db,
      );
    });

    it('keeps an existing active seat instead of opening another', async () => {
      db.projectCreatorAssignment.findFirst.mockResolvedValue({ id: 'seat' });
      await service.addCreator('p1', { creatorId: 'second' }, REVIEWER);
      expect(db.projectCreatorAssignment.create).not.toHaveBeenCalled();
    });

    it('needs a lead first, an active Creator and an editable project', async () => {
      access.project.mockResolvedValue({ ...PROJECT, creatorId: null });
      await expect(service.addCreator('p1', { creatorId: 'x' }, REVIEWER)).rejects.toBeInstanceOf(ConflictException);
      access.project.mockResolvedValue(PROJECT);
      db.user.findUnique.mockResolvedValue({ role: UserRole.CONTENT_CREATOR, isActive: false });
      await expect(service.addCreator('p1', { creatorId: 'x' }, REVIEWER)).rejects.toBeInstanceOf(BadRequestException);
      access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.COMPLETED });
      await expect(service.addCreator('p1', { creatorId: 'x' }, REVIEWER)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('removeCreator', () => {
    it('ends the seat and gives their episodes back to the team', async () => {
      await service.removeCreator('p1', 'second', REVIEWER);
      expect(db.projectCreatorAssignment.updateMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', creatorId: 'second', isActive: true },
        data: expect.objectContaining({ isActive: false }),
      });
      expect(db.episode.updateMany).toHaveBeenCalledWith({
        where: { movieId: 'p1', assignedCreatorId: 'second' },
        data: { assignedCreatorId: null },
      });
      expect(actions()).toEqual([CONTENT_EVENT.CREATOR_REMOVED]);
    });

    it('refuses the lead and someone without a seat', async () => {
      await expect(service.removeCreator('p1', 'lead', REVIEWER)).rejects.toBeInstanceOf(ConflictException);
      db.projectCreatorAssignment.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.removeCreator('p1', 'x', REVIEWER)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('delegate', () => {
    const dto = { toCreatorId: 'second', episodeIds: ['e1', 'e2'] };

    it("lets the lead hand over their own and the team's episodes", async () => {
      db.episode.findMany.mockResolvedValue([
        { id: 'e1', assignedCreatorId: 'lead' },
        { id: 'e2', assignedCreatorId: null },
      ]);
      await service.delegate('p1', dto, LEAD);
      expect(db.projectCreatorAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ creatorId: 'second', assignedById: 'lead', delegatedFromId: 'lead' }),
      });
      expect(db.episode.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['e1', 'e2'] } },
        data: { assignedCreatorId: 'second' },
      });
      expect(actions()).toEqual([CONTENT_EVENT.EPISODE_DELEGATED]);
    });

    it('refuses delegating to oneself and an episode of another project', async () => {
      await expect(service.delegate('p1', { ...dto, toCreatorId: 'lead' }, LEAD)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      db.episode.findMany.mockResolvedValue([{ id: 'e1', assignedCreatorId: 'lead' }]);
      await expect(service.delegate('p1', dto, LEAD)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses episodes that are not the caller's", async () => {
      db.episode.findMany.mockResolvedValue([
        { id: 'e1', assignedCreatorId: 'lead' },
        { id: 'e2', assignedCreatorId: 'someone' },
      ]);
      await expect(service.delegate('p1', dto, LEAD)).rejects.toBeInstanceOf(ForbiddenException);
      // Only the lead may hand over an episode nobody holds.
      db.episode.findMany.mockResolvedValue([
        { id: 'e1', assignedCreatorId: 'third' },
        { id: 'e2', assignedCreatorId: null },
      ]);
      await expect(service.delegate('p1', dto, { id: 'third', role: UserRole.CONTENT_CREATOR })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('assignEpisode', () => {
    const episode = { id: 'e1', episodeNumber: 2, movie: { title: 'Phim' }, project: PROJECT };

    beforeEach(() => {
      access.episode.mockResolvedValue(episode);
      access.isOnTeam.mockResolvedValue(true);
      db.episode.update.mockResolvedValue({ id: 'e1' });
    });

    it('gives the episode to a team member and tells them', async () => {
      await expect(service.assignEpisode('e1', 'second', REVIEWER)).resolves.toEqual({ id: 'e1' });
      expect(db.episode.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { assignedCreatorId: 'second' } });
      expect(notifications.notify).toHaveBeenCalledWith(
        ['second'],
        expect.objectContaining({ type: NOTIFICATION_TYPE.EPISODE_ASSIGNED }),
        db,
      );
    });

    it('gives the episode back to the team without telling anyone', async () => {
      await service.assignEpisode('e1', undefined, LEAD);
      expect(db.episode.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { assignedCreatorId: null } });
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(actions()).toEqual([CONTENT_EVENT.EPISODE_ASSIGNED]);
    });

    it('only takes the Reviewer or the lead, and a Creator of the team', async () => {
      await expect(service.assignEpisode('e1', 'second', SECOND)).rejects.toBeInstanceOf(ForbiddenException);
      access.isOnTeam.mockResolvedValue(false);
      await expect(service.assignEpisode('e1', 'x', REVIEWER)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('reports no released seat so the caller can tell', async () => {
    db.projectCreatorAssignment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.release(db as unknown as PrismaTx, 'p1', 'x')).resolves.toBe(false);
  });
});
