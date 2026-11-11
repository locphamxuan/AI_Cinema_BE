import { Readable } from 'node:stream';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { ChangeRequestStatus, ChangeRequestType, ProjectStatus, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ChangeRequestService } from './change-request.service';

const REVIEWER = { id: 'rev', role: UserRole.CONTENT_REVIEWER };
const ADMIN = { id: 'admin', role: UserRole.ADMIN };
const PROJECT = { id: 'p1', status: ProjectStatus.IN_PRODUCTION, reviewerId: 'rev', movie: { title: 'Phim' } };
const PDF = { originalname: 'bang-chung.pdf', size: 9, buffer: Buffer.from('%PDF-1.4\n') } as Express.Multer.File;
const DTO = { content: ' Đổi tên ', reason: ' Trùng tên ' };

describe('ChangeRequestService', () => {
  const db = {
    projectChangeRequest: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findMany: jest.fn() },
    season: { count: jest.fn() },
    episode: { count: jest.fn() },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn(), isOnTeam: jest.fn() };
  const storage = { putBuffer: jest.fn(), remove: jest.fn(), stream: jest.fn() };
  const notifications = { notify: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new ChangeRequestService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    storage as unknown as ObjectStorage,
    notifications as unknown as NotificationService,
    auditLog as unknown as AuditLogService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.project.mockResolvedValue(PROJECT);
    access.isOnTeam.mockResolvedValue(false);
    db.projectChangeRequest.create.mockResolvedValue({ id: 'cr1' });
    db.user.findMany.mockResolvedValue([{ id: 'admin' }]);
    db.season.count.mockResolvedValue(1);
    db.episode.count.mockResolvedValue(1);
    storage.remove.mockResolvedValue(undefined);
  });

  describe('propose', () => {
    it('stores the proof, tells the Admins and audits the request', async () => {
      await expect(service.propose('p1', DTO, PDF, REVIEWER)).resolves.toEqual({ id: 'cr1' });
      const [key, , mime, visibility] = storage.putBuffer.mock.calls[0] as [string, Buffer, string, string];
      expect(key).toMatch(/^movies\/p1\/change-requests\/.+\.pdf$/);
      expect([mime, visibility]).toEqual(['application/pdf', 'private']);
      expect(db.projectChangeRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestedById: 'rev',
            requestType: ChangeRequestType.PROJECT_UPDATE,
            content: 'Đổi tên',
            reason: 'Trùng tên',
            attachmentName: 'bang-chung.pdf',
            attachmentKey: key,
          }),
        }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        ['admin'],
        expect.objectContaining({ type: NOTIFICATION_TYPE.CHANGE_REQUESTED }),
        db,
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: CONTENT_EVENT.PROJECT_CHANGE_REQUESTED, entityId: 'cr1' }),
        db,
      );
    });

    it('takes a Creator of the team, without proof, and tells the Reviewer too', async () => {
      access.isOnTeam.mockResolvedValue(true);
      const creator = { id: 'cre', role: UserRole.CONTENT_CREATOR };
      await service.propose('p1', { ...DTO, requestType: ChangeRequestType.OTHER }, undefined, creator);
      expect(storage.putBuffer).not.toHaveBeenCalled();
      const [watchers] = notifications.notify.mock.calls[0] as [string[]];
      expect(watchers).toEqual(['admin', 'rev']);
    });

    it('refuses an outsider, a cancelled project and a scope of another project', async () => {
      await expect(service.propose('p1', DTO, undefined, { id: 'x', role: UserRole.STAFF })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.CANCELLED });
      await expect(service.propose('p1', DTO, undefined, REVIEWER)).rejects.toBeInstanceOf(ConflictException);
      access.project.mockResolvedValue(PROJECT);
      db.season.count.mockResolvedValue(0);
      await expect(service.propose('p1', { ...DTO, seasonId: 's9' }, undefined, REVIEWER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      db.season.count.mockResolvedValue(1);
      db.episode.count.mockResolvedValue(0);
      await expect(service.propose('p1', { ...DTO, episodeId: 'e9' }, undefined, REVIEWER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.projectChangeRequest.create).not.toHaveBeenCalled();
    });

    it('refuses an empty proof before storing anything', async () => {
      await expect(service.propose('p1', DTO, { ...PDF, size: 0 }, REVIEWER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.putBuffer).not.toHaveBeenCalled();
    });

    it('removes the stored proof when the transaction fails, and still surfaces that failure', async () => {
      db.projectChangeRequest.create.mockRejectedValue(new Error('db down'));
      storage.remove.mockRejectedValue(new Error('storage down'));
      await expect(service.propose('p1', DTO, PDF, REVIEWER)).rejects.toThrow('db down');
      const [key] = storage.putBuffer.mock.calls[0] as [string];
      expect(storage.remove).toHaveBeenCalledWith(key, 'private');
    });
  });

  it('lists a project after checking access, and the inbox with open requests first', async () => {
    db.projectChangeRequest.findMany.mockResolvedValue([]);
    await service.list('p1', REVIEWER);
    expect(access.project).toHaveBeenCalledWith('p1', REVIEWER, 'read');
    await service.inbox(ChangeRequestStatus.OPEN);
    expect(db.projectChangeRequest.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: ChangeRequestStatus.OPEN },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 200,
      }),
    );
  });

  describe('proof', () => {
    it('streams the attachment to someone who can read the project', async () => {
      db.projectChangeRequest.findUnique.mockResolvedValue({
        projectId: 'p1',
        attachmentKey: 'k',
        attachmentMimeType: 'application/pdf',
        attachmentName: 'bằng chứng.pdf',
      });
      storage.stream.mockResolvedValue(Readable.from('x'));
      const file = await service.proof('cr1', REVIEWER);
      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.getHeaders().disposition).toBe(
        `attachment; filename*=UTF-8''${encodeURIComponent('bằng chứng.pdf')}`,
      );
      expect(access.project).toHaveBeenCalledWith('p1', REVIEWER, 'read');
    });

    it('answers 404 without an attachment', async () => {
      db.projectChangeRequest.findUnique.mockResolvedValue({ projectId: 'p1', attachmentKey: null });
      await expect(service.proof('cr1', REVIEWER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolve', () => {
    const open = { projectId: 'p1', requestedById: 'cre', project: { reviewerId: 'rev', movie: { title: 'Phim' } } };

    beforeEach(() => {
      db.projectChangeRequest.findUnique.mockResolvedValue(open);
      db.projectChangeRequest.updateMany.mockResolvedValue({ count: 1 });
      db.projectChangeRequest.findUniqueOrThrow.mockResolvedValue({ id: 'cr1' });
    });

    it('approves without a response and tells the requester and the Reviewer', async () => {
      await expect(service.resolve('cr1', true, { response: '  ' }, ADMIN)).resolves.toEqual({ id: 'cr1' });
      expect(db.projectChangeRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'cr1', status: ChangeRequestStatus.OPEN },
        data: expect.objectContaining({
          status: ChangeRequestStatus.APPROVED,
          adminResponse: null,
          resolvedById: 'admin',
        }),
      });
      const [recipients] = notifications.notify.mock.calls[0] as [string[]];
      expect(recipients).toEqual(['cre', 'rev']);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: CONTENT_EVENT.PROJECT_CHANGE_APPROVED }),
        db,
      );
    });

    it('rejects with a reason', async () => {
      await service.resolve('cr1', false, { response: ' Không hợp lệ ' }, ADMIN);
      expect(db.projectChangeRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ChangeRequestStatus.REJECTED, adminResponse: 'Không hợp lệ' }),
        }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: CONTENT_EVENT.PROJECT_CHANGE_REJECTED }),
        db,
      );
    });

    it('refuses a rejection without a reason, an unknown request and a second answer', async () => {
      await expect(service.resolve('cr1', false, {}, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
      db.projectChangeRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.resolve('cr1', true, {}, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      db.projectChangeRequest.findUnique.mockResolvedValue(null);
      await expect(service.resolve('x', true, {}, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });
});
