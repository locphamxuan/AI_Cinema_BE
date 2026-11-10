import { Readable } from 'node:stream';
import { BadRequestException, ConflictException, NotFoundException, StreamableFile } from '@nestjs/common';
import { ProjectStatus, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { IdeaFileService } from './idea-file.service';

const REVIEWER = { id: 'rev', role: UserRole.CONTENT_REVIEWER };
const PROJECT = { id: 'p1', status: ProjectStatus.DRAFT };
const upload = (originalname: string, buffer: Buffer) =>
  ({ originalname, buffer, size: buffer.length }) as Express.Multer.File;
const PDF = upload('Y-tuong.PDF', Buffer.from('%PDF-1.4\n'));

describe('IdeaFileService', () => {
  const db = {
    $queryRaw: jest.fn(),
    movieIdeaFile: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn() };
  const storage = { putBuffer: jest.fn(), remove: jest.fn(), stream: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new IdeaFileService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    storage as unknown as ObjectStorage,
    auditLog as unknown as AuditLogService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.project.mockResolvedValue(PROJECT);
    db.movieIdeaFile.aggregate.mockResolvedValue({ _max: { version: 2 } });
    db.movieIdeaFile.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'f1', ...data }));
    storage.remove.mockResolvedValue(undefined);
  });

  describe('upload', () => {
    it('stores the file privately and adds the next version under the project lock', async () => {
      await expect(service.upload('p1', PDF, REVIEWER)).resolves.toMatchObject({
        id: 'f1',
        projectId: 'p1',
        fileName: 'Y-tuong.PDF',
        purpose: 'IDEA',
        version: 3,
        mimeType: 'application/pdf',
        sizeBytes: 9n,
      });
      const [key, , mime, visibility] = storage.putBuffer.mock.calls[0] as [string, Buffer, string, string];
      expect(key).toMatch(/^movies\/p1\/ideas\/.+\.pdf$/);
      expect([mime, visibility]).toEqual(['application/pdf', 'private']);
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: CONTENT_EVENT.IDEA_FILE_UPLOADED,
          payload: { fileName: 'Y-tuong.PDF', purpose: 'IDEA', version: 3 },
        }),
        db,
      );
    });

    it('starts a new name at version 1 and keeps the purpose', async () => {
      db.movieIdeaFile.aggregate.mockResolvedValue({ _max: { version: null } });
      await expect(service.upload('p1', PDF, REVIEWER, 'REFERENCE' as never)).resolves.toMatchObject({
        version: 1,
        purpose: 'REFERENCE',
      });
    });

    it('accepts UTF-8 text and refuses other encodings', async () => {
      await expect(service.upload('p1', upload('note.txt', Buffer.from('Xin chào')), REVIEWER)).resolves.toMatchObject({
        mimeType: 'text/plain',
      });
      const latin1 = upload('note.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]));
      await expect(service.upload('p1', latin1, REVIEWER)).rejects.toThrow(/UTF-8/);
      const nul = upload('note.txt', Buffer.from([0x61, 0x00, 0x62]));
      await expect(service.upload('p1', nul, REVIEWER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a missing file, content that contradicts its name and a closed project', async () => {
      await expect(service.upload('p1', undefined, REVIEWER)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.upload('p1', upload('a.pdf', Buffer.from('nope')), REVIEWER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.COMPLETED });
      await expect(service.upload('p1', PDF, REVIEWER)).rejects.toBeInstanceOf(ConflictException);
      expect(storage.putBuffer).not.toHaveBeenCalled();
    });
  });

  it('lists the versions after checking access', async () => {
    db.movieIdeaFile.findMany.mockResolvedValue([]);
    await service.list('p1', REVIEWER);
    expect(access.project).toHaveBeenCalledWith('p1', REVIEWER, 'read');
    expect(db.movieIdeaFile.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
      orderBy: [{ fileName: 'asc' }, { version: 'desc' }],
    });
  });

  describe('remove', () => {
    it('deletes the row, then the object', async () => {
      db.movieIdeaFile.findFirst.mockResolvedValue({ id: 'f1', storageKey: 'k1' });
      await service.remove('p1', 'f1', REVIEWER);
      expect(db.movieIdeaFile.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
      expect(storage.remove).toHaveBeenCalledWith('k1', 'private');
    });

    it('does not fail when the object cannot be removed', async () => {
      db.movieIdeaFile.findFirst.mockResolvedValue({ id: 'f1', storageKey: 'k1' });
      storage.remove.mockRejectedValue(new Error('storage down'));
      await expect(service.remove('p1', 'f1', REVIEWER)).resolves.toBeUndefined();
    });

    it('answers 404 for a file of another project and refuses a closed project', async () => {
      db.movieIdeaFile.findFirst.mockResolvedValue(null);
      await expect(service.remove('p1', 'x', REVIEWER)).rejects.toBeInstanceOf(NotFoundException);
      access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.CANCELLED });
      await expect(service.remove('p1', 'x', REVIEWER)).rejects.toBeInstanceOf(ConflictException);
      expect(db.movieIdeaFile.delete).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('streams the file with its type, name and length', async () => {
      db.movieIdeaFile.findFirst.mockResolvedValue({
        storageKey: 'k1',
        mimeType: 'application/pdf',
        fileName: 'ý tưởng.pdf',
        sizeBytes: 9n,
      });
      storage.stream.mockResolvedValue(Readable.from('x'));
      const file = await service.download('p1', 'f1', REVIEWER);
      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.getHeaders()).toMatchObject({
        type: 'application/pdf',
        length: 9,
        disposition: `attachment; filename*=UTF-8''${encodeURIComponent('ý tưởng.pdf')}`,
      });
    });

    it('answers 404 for an unknown file', async () => {
      db.movieIdeaFile.findFirst.mockResolvedValue(null);
      await expect(service.download('p1', 'x', REVIEWER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
