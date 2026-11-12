import { BadRequestException, ConflictException } from '@nestjs/common';
import { EpisodeStatus, ProjectStatus, UnpublishReason, UserRole } from '@prisma/client';
import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ProjectLifecycleService } from './project-lifecycle.service';
import type { ProjectTeamService } from './team/project-team.service';

const ADMIN = { id: 'admin', role: UserRole.ADMIN };
const PROJECT = {
  id: 'p1',
  status: ProjectStatus.DRAFT,
  creatorId: null as string | null,
  reviewerId: 'rev',
  movie: { title: 'Phim' },
};

describe('ProjectLifecycleService', () => {
  const db = {
    user: { findUnique: jest.fn() },
    movieProject: { findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
    publication: { count: jest.fn(), updateMany: jest.fn() },
    episode: { count: jest.fn(), updateMany: jest.fn() },
    contract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    studioHandoff: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn() };
  const team = { release: jest.fn(), seat: jest.fn() };
  const notifications = { notify: jest.fn(), studioAccountIds: jest.fn().mockResolvedValue(['st1']) };
  const auditLog = { record: jest.fn() };
  const service = new ProjectLifecycleService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    team as unknown as ProjectTeamService,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );
  const tx = db as unknown as PrismaTx;

  beforeEach(() => {
    jest.clearAllMocks();
    access.project.mockResolvedValue(PROJECT);
    db.user.findUnique.mockResolvedValue({ role: UserRole.CONTENT_CREATOR, isActive: true });
    db.movieProject.updateMany.mockResolvedValue({ count: 1 });
    db.publication.count.mockResolvedValue(0);
    db.publication.updateMany.mockResolvedValue({ count: 0 });
  });

  it('accepts only an active account of the expected role', async () => {
    await expect(service.assertActive('u1', UserRole.CONTENT_CREATOR)).resolves.toBeUndefined();
    await expect(service.assertActive('u1', UserRole.CONTENT_REVIEWER)).rejects.toBeInstanceOf(BadRequestException);
    db.user.findUnique.mockResolvedValue({ role: UserRole.CONTENT_CREATOR, isActive: false });
    await expect(service.assertActive('u1', UserRole.CONTENT_CREATOR)).rejects.toBeInstanceOf(BadRequestException);
    db.user.findUnique.mockResolvedValue(null);
    await expect(service.assertActive('ghost', UserRole.CONTENT_CREATOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tells the Reviewer they are in charge of a new project', async () => {
    db.movieProject.findUniqueOrThrow.mockResolvedValue(PROJECT);
    await service.announceReviewer('p1');
    expect(notifications.notify).toHaveBeenCalledWith(
      ['rev'],
      expect.objectContaining({ type: NOTIFICATION_TYPE.PROJECT_ASSIGNED, link: '/projects/p1' }),
    );
  });

  it('assigns the first lead Creator and moves a draft project to ASSIGNED', async () => {
    await service.assignCreator('p1', 'cre', ADMIN);
    expect(db.movieProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { in: [ProjectStatus.DRAFT, ProjectStatus.ASSIGNED, ProjectStatus.IN_PRODUCTION] } },
      data: { creatorId: 'cre', status: ProjectStatus.ASSIGNED },
    });
    expect(team.release).not.toHaveBeenCalled();
    expect(team.seat).toHaveBeenCalledWith(db, PROJECT, 'cre', { assignedById: 'admin' });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.PROJECT_ASSIGNED,
        payload: { creatorId: 'cre', previousCreatorId: null },
      }),
      db,
    );
  });

  it('releases the previous lead when the Admin reassigns, keeping the project status', async () => {
    access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.IN_PRODUCTION, creatorId: 'old' });
    await service.assignCreator('p1', 'cre', ADMIN);
    expect(db.movieProject.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { creatorId: 'cre', status: ProjectStatus.IN_PRODUCTION } }),
    );
    expect(team.release).toHaveBeenCalledWith(db, 'p1', 'old');
  });

  it('refuses to assign on a closed project or when the project changed meanwhile', async () => {
    access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.COMPLETED });
    await expect(service.assignCreator('p1', 'cre', ADMIN)).rejects.toBeInstanceOf(ConflictException);
    access.project.mockResolvedValue(PROJECT);
    db.movieProject.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.assignCreator('p1', 'cre', ADMIN)).rejects.toBeInstanceOf(ConflictException);
    expect(team.seat).not.toHaveBeenCalled();
  });

  it('cancels an unpublished project and withdraws its scheduled releases (BR-39)', async () => {
    db.publication.updateMany.mockResolvedValue({ count: 2 });
    await service.cancel('p1', '  Hết ngân sách ', ADMIN);
    expect(db.movieProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: { in: expect.any(Array) as unknown } },
      data: expect.objectContaining({ status: ProjectStatus.CANCELLED, cancelReason: 'Hết ngân sách' }),
    });
    expect(db.publication.updateMany).toHaveBeenCalledWith({
      where: { episode: { movieId: 'p1' }, publishedAt: null, unpublishedAt: null },
      data: expect.objectContaining({
        unpublishReason: UnpublishReason.MANUAL,
        unpublishNote: 'Project cancelled: Hết ngân sách',
        unpublishedById: 'admin',
      }),
    });
    expect(db.episode.updateMany).toHaveBeenCalledWith({
      where: { movieId: 'p1', status: EpisodeStatus.SCHEDULED },
      data: { status: EpisodeStatus.COMPLIANCE_PASSED },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.PROJECT_CANCELLED,
        payload: expect.objectContaining({ withdrawnReleases: 2, closedContracts: 1, closedHandoffs: 0 }) as unknown,
      }),
      db,
    );
  });

  it('closes the open contract rounds and tells the Reviewer and the studio as well', async () => {
    access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.ASSIGNED, creatorId: 'cre', studioId: 's1' });
    db.publication.count.mockResolvedValue(0);
    db.movieProject.updateMany.mockResolvedValue({ count: 1 });
    db.publication.updateMany.mockResolvedValue({ count: 0 });
    await service.cancel('p1', 'Đổi kế hoạch', ADMIN);
    expect(db.contract.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', status: { in: ['SENT', 'STUDIO_SIGNED', 'ADMIN_COUNTERED'] } },
      data: { status: 'SUPERSEDED' },
    });
    expect(db.studioHandoff.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1', milestoneStatus: 'BRIEF_SENT' } }),
    );
    expect(notifications.studioAccountIds).toHaveBeenCalledWith('s1', db);
    expect(notifications.notify).toHaveBeenCalledWith(['cre', 'rev', 'st1'], expect.anything(), db);
  });

  it('refuses to cancel once an episode was published', async () => {
    db.publication.count.mockResolvedValue(1);
    await expect(service.cancel('p1', 'x', ADMIN)).rejects.toBeInstanceOf(ConflictException);
    expect(db.movieProject.updateMany).not.toHaveBeenCalled();
  });

  it('completes a delivering project once every episode is out, and records it once', async () => {
    db.episode.count.mockResolvedValue(0);
    await expect(service.completeIfAllPublished('p1', tx)).resolves.toBe(true);
    expect(db.episode.count).toHaveBeenCalledWith({
      where: { movieId: 'p1', status: { notIn: [EpisodeStatus.PUBLISHED, EpisodeStatus.UNPUBLISHED] } },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.PROJECT_COMPLETED, actorId: null }),
      db,
    );

    jest.clearAllMocks();
    db.episode.count.mockResolvedValue(0);
    db.movieProject.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.completeIfAllPublished('p1', tx)).resolves.toBe(false);
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('keeps the project open while an episode is still pending', async () => {
    db.episode.count.mockResolvedValue(1);
    await expect(service.completeIfAllPublished('p1', tx)).resolves.toBe(false);
    expect(db.movieProject.updateMany).not.toHaveBeenCalled();
  });
});
