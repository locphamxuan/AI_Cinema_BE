import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { BadRequestException, NotFoundException, StreamableFile } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { StudioAccountService } from 'src/modules/production/studio/studio-account.service';
import { StudioPosterService } from './studio-poster.service';
import { studioPosterOf } from './studio-poster.view';

const STUDIO_USER = { id: 'su1', role: UserRole.STUDIO };
const ADMIN = { id: 'a1', role: UserRole.ADMIN };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const image = (name = 'Poster phim.png', buffer = PNG) =>
  ({ originalname: name, size: buffer.length, buffer }) as Express.Multer.File;

describe('StudioPosterService', () => {
  const tx = { movieProject: { update: jest.fn() } };
  const prisma = {
    movieProject: { findUniqueOrThrow: jest.fn() },
    $transaction: jest.fn((write: (t: typeof tx) => Promise<unknown>) => write(tx)),
  };
  const access = { studioProject: jest.fn(), project: jest.fn() };
  const accounts = { studioOf: jest.fn() };
  const storage = {
    putBuffer: jest.fn(),
    putFile: jest.fn(),
    remove: jest.fn(),
    stream: jest.fn(),
  };
  const auditLog = { record: jest.fn() };
  const service = new StudioPosterService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    accounts as unknown as StudioAccountService,
    storage as unknown as ObjectStorage,
    auditLog as unknown as AuditLogService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    accounts.studioOf.mockResolvedValue('s1');
    access.studioProject.mockResolvedValue({ id: 'p1' });
    prisma.movieProject.findUniqueOrThrow.mockResolvedValue({ studioPosterKey: null });
    tx.movieProject.update.mockResolvedValue({
      studioPosterFileName: 'Poster phim.png',
      studioPosterUploadedAt: new Date(3),
    });
  });

  describe('upload', () => {
    it('stores the image privately, records it and answers its name and time', async () => {
      const result = await service.upload('p1', image(), STUDIO_USER);

      expect(access.studioProject).toHaveBeenCalledWith('p1', 's1');
      const [key, body, mime, visibility] = storage.putBuffer.mock.calls[0] as [string, Buffer, string, string];
      expect(key).toMatch(/^movies\/p1\/studio-poster\/[0-9a-f-]{36}\.png$/);
      expect([body, mime, visibility]).toEqual([PNG, 'image/png', 'private']);
      expect(tx.movieProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({
            studioPosterKey: key,
            studioPosterFileName: 'Poster phim.png',
            studioPosterMimeType: 'image/png',
          }) as unknown,
        }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: CONTENT_EVENT.STUDIO_POSTER_UPLOADED, projectId: 'p1', actorId: 'su1' }),
        tx,
      );
      expect(result).toEqual({ studioPoster: { fileName: 'Poster phim.png', uploadedAt: new Date(3) } });
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('reads a disk upload from its temporary file and removes the poster it replaces', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'studio-poster-'));
      const path = join(dir, 'upload');
      await writeFile(path, PNG);
      prisma.movieProject.findUniqueOrThrow.mockResolvedValue({ studioPosterKey: 'movies/p1/studio-poster/old.png' });
      try {
        await service.upload(
          'p1',
          { originalname: 'p.png', size: PNG.length, path } as Express.Multer.File,
          STUDIO_USER,
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      expect(storage.putFile).toHaveBeenCalledWith(expect.any(String), path, 'image/png', 'private');
      expect(storage.remove).toHaveBeenCalledWith('movies/p1/studio-poster/old.png', 'private');
    });

    it('removes the stored image when the database write fails', async () => {
      tx.movieProject.update.mockRejectedValue(new Error('db down'));
      await expect(service.upload('p1', image(), STUDIO_USER)).rejects.toThrow('db down');
      const [key] = storage.putBuffer.mock.calls[0] as [string];
      expect(storage.remove).toHaveBeenCalledWith(key, 'private');
    });

    it('rejects a missing file and a file that is not an image', async () => {
      await expect(service.upload('p1', undefined, STUDIO_USER)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.upload('p1', image('a.pdf', Buffer.from('%PDF-1.7')), STUDIO_USER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.putBuffer).not.toHaveBeenCalled();
    });

    it('never stores a poster for a project of another studio', async () => {
      access.studioProject.mockRejectedValue(new NotFoundException());
      await expect(service.upload('p9', image(), STUDIO_USER)).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.putBuffer).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('streams the poster as an attachment with its original name', async () => {
      prisma.movieProject.findUniqueOrThrow.mockResolvedValue({
        studioPosterKey: 'movies/p1/studio-poster/x.png',
        studioPosterFileName: 'Poster phim.png',
        studioPosterMimeType: 'image/png',
      });
      storage.stream.mockResolvedValue(Readable.from(PNG));

      const file = await service.download('p1', ADMIN);

      expect(access.project).toHaveBeenCalledWith('p1', ADMIN, 'read');
      expect(storage.stream).toHaveBeenCalledWith('movies/p1/studio-poster/x.png', 'private');
      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.options).toMatchObject({
        type: 'image/png',
        disposition: "attachment; filename*=UTF-8''Poster%20phim.png",
      });
    });

    it('answers 404 before the studio sends a poster', async () => {
      prisma.movieProject.findUniqueOrThrow.mockResolvedValue({ studioPosterKey: null });
      await expect(service.download('p1', ADMIN)).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.stream).not.toHaveBeenCalled();
    });
  });

  it('shows nothing of a poster that was never sent', () => {
    expect(studioPosterOf({ studioPosterFileName: null, studioPosterUploadedAt: null })).toBeNull();
  });
});
