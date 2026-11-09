import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ProjectStatus, UserRole } from '@prisma/client';
import { PERMISSION } from 'src/common/auth/permissions';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AccessControlService } from 'src/modules/identity/access-control/access-control.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ProjectNoteService } from './project-note.service';

const ADMIN = { id: 'admin', role: UserRole.ADMIN };
const CREATOR = { id: 'cre', role: UserRole.CONTENT_CREATOR };
const REVIEWER = { id: 'rev', role: UserRole.CONTENT_REVIEWER };
const PROJECT = {
  id: 'p1',
  status: ProjectStatus.ASSIGNED,
  creatorId: 'cre',
  reviewerId: 'rev',
  movie: { title: 'Phim' },
};

describe('ProjectNoteService', () => {
  const db = { auditLog: { findMany: jest.fn() } };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn() };
  const accessControl = { permissionsOf: jest.fn() };
  const auditLog = { record: jest.fn() };
  const notifications = { notify: jest.fn(), adminIds: jest.fn() };
  const service = new ProjectNoteService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    accessControl as unknown as AccessControlService,
    auditLog as unknown as AuditLogService,
    notifications as unknown as NotificationService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.project.mockResolvedValue(PROJECT);
    notifications.adminIds.mockResolvedValue(['admin', 'admin-2']);
    accessControl.permissionsOf.mockImplementation((role: UserRole) =>
      Promise.resolve(new Set(role === UserRole.ADMIN ? [PERMISSION.PROJECT_CREATE] : [])),
    );
    db.auditLog.findMany.mockResolvedValue([]);
  });

  it('lists the notes of a readable project oldest first, tolerating a payload without a message', async () => {
    const createdAt = new Date('2026-11-07T00:00:00Z');
    db.auditLog.findMany.mockResolvedValue([
      { id: 'n1', payload: { message: 'Hướng đi' }, createdAt, actor: { id: 'admin', fullName: 'A', role: 'ADMIN' } },
      { id: 'n2', payload: null, createdAt, actor: null },
    ]);
    await expect(service.list('p1', CREATOR)).resolves.toEqual([
      { id: 'n1', message: 'Hướng đi', createdAt, author: { id: 'admin', fullName: 'A', role: 'ADMIN' } },
      { id: 'n2', message: '', createdAt, author: null },
    ]);
    expect(access.project).toHaveBeenCalledWith('p1', CREATOR, 'read');
    expect(db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: CONTENT_EVENT.PROJECT_NOTE_SENT, entityType: 'MovieProject', entityId: 'p1' },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('records the trimmed note and tells everyone in the thread except the writer', async () => {
    await service.send('p1', '  Ý tưởng mới  ', CREATOR);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.PROJECT_NOTE_SENT,
        entityId: 'p1',
        projectId: 'p1',
        actorId: 'cre',
        payload: { message: 'Ý tưởng mới' },
      }),
      db,
    );
    const [recipients, content] = notifications.notify.mock.calls[0] as [string[], { type: string; body: string }];
    expect(recipients).toEqual(['rev', 'admin', 'admin-2']);
    expect(content).toMatchObject({ type: NOTIFICATION_TYPE.PROJECT_NOTE, body: 'Ý tưởng mới' });
  });

  it('lets an Admin who is not on the team write, without notifying the Admin twice', async () => {
    await service.send('p1', 'Chốt hướng', ADMIN);
    const [recipients] = notifications.notify.mock.calls[0] as [string[]];
    expect(recipients).toEqual(['cre', 'rev', 'admin-2']);
  });

  it('shortens a long note in the notification but keeps it whole in the history', async () => {
    const long = 'x'.repeat(400);
    await service.send('p1', long, REVIEWER);
    const [, content] = notifications.notify.mock.calls[0] as [string[], { body: string }];
    expect(content.body).toHaveLength(300);
    expect(content.body.endsWith('...')).toBe(true);
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ payload: { message: long } }), db);
  });

  it('refuses someone outside the thread, an empty note and a closed project', async () => {
    await expect(service.send('p1', 'Hi', { id: 'other', role: UserRole.CONTENT_CREATOR })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.send('p1', '   ', CREATOR)).rejects.toBeInstanceOf(BadRequestException);
    access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.CANCELLED });
    await expect(service.send('p1', 'Hi', CREATOR)).rejects.toBeInstanceOf(ConflictException);
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('still takes notes while the project is under revision', async () => {
    access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.UNDER_REVISION });
    await expect(service.send('p1', 'Sửa lại', CREATOR)).resolves.toEqual([]);
  });
});
