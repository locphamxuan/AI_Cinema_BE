import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ArtworkService } from './artwork.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const file = (originalname = 'poster.png', buffer = PNG) =>
  ({ originalname, buffer, size: buffer.length }) as Express.Multer.File;
const reviewer = { id: 'u-rev', role: 'CONTENT_REVIEWER' } as AuthenticatedUser;
const BASE = 'https://cdn.example/';

type Tx = { movie: { update: jest.Mock }; episode: { update: jest.Mock } };

describe('ArtworkService', () => {
  const tx: Tx = { movie: { update: jest.fn() }, episode: { update: jest.fn() } };
  const runWrite = (write: (t: Tx) => Promise<void>) => write(tx);
  const prisma = { movie: { findUniqueOrThrow: jest.fn() }, $transaction: jest.fn() };
  const access = { project: jest.fn(), episode: jest.fn(), canPublish: jest.fn().mockResolvedValue(false) };
  const storage = {
    putBuffer: jest.fn(),
    remove: jest.fn(),
    publicUrl: jest.fn((key: string) => `${BASE}${key}`),
  };
  const auditLog = { record: jest.fn() };
  const service = new ArtworkService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    storage as unknown as ObjectStorage,
    auditLog as unknown as AuditLogService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(runWrite);
    access.project.mockResolvedValue({ id: 'm1', status: ProjectStatus.IN_PRODUCTION });
    prisma.movie.findUniqueOrThrow.mockResolvedValue({ posterUrl: `${BASE}movies/m1/artwork/old.png` });
  });

  it('stores the poster, links it, audits it and removes the image it replaces', async () => {
    const { posterUrl } = await service.uploadPoster('m1', file(), reviewer);

    expect(posterUrl.startsWith(`${BASE}movies/m1/artwork/`)).toBe(true);
    expect(posterUrl.endsWith('.png')).toBe(true);
    expect(storage.putBuffer).toHaveBeenCalledWith(expect.any(String), PNG, 'image/png', 'public');
    expect(tx.movie.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { posterUrl } });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'Movie', payload: { fields: ['poster'] } }),
      tx,
    );
    expect(storage.remove).toHaveBeenCalledWith('movies/m1/artwork/old.png', 'public');
  });

  it('lets the Admin who publishes set the poster without being the Reviewer in charge', async () => {
    access.canPublish.mockResolvedValueOnce(true);
    await service.uploadPoster('m1', file(), reviewer);
    expect(access.project).toHaveBeenLastCalledWith('m1', reviewer, 'read');
  });

  it('asks a Reviewer to be the one in charge of the project', async () => {
    await service.uploadPoster('m1', file(), reviewer);
    expect(access.project).toHaveBeenLastCalledWith('m1', reviewer, 'reviewer');
  });

  it('keeps a poster that is not one of ours', async () => {
    prisma.movie.findUniqueOrThrow.mockResolvedValue({ posterUrl: 'https://elsewhere.example/p.png' });

    await service.uploadPoster('m1', file(), reviewer);

    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('refuses a missing file and a file that is not an image', async () => {
    await expect(service.uploadPoster('m1', undefined, reviewer)).rejects.toThrow(BadRequestException);
    await expect(
      service.uploadPoster('m1', file('poster.png', Buffer.from('%PDF-1.7 nope')), reviewer),
    ).rejects.toThrow();
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  it('refuses a project that can no longer be edited', async () => {
    access.project.mockResolvedValue({ id: 'm1', status: ProjectStatus.CANCELLED });

    await expect(service.uploadPoster('m1', file(), reviewer)).rejects.toThrow(ConflictException);
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  it('removes the image just stored when the database write fails', async () => {
    prisma.$transaction.mockRejectedValue(new Error('db down'));

    await expect(service.uploadPoster('m1', file(), reviewer)).rejects.toThrow('db down');

    const [storedKey] = storage.putBuffer.mock.calls[0] as [string];
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith(storedKey, 'public');
  });

  it('stores an episode thumbnail and drops the old one', async () => {
    access.episode.mockResolvedValue({
      id: 'e1',
      movieId: 'm1',
      thumbnailUrl: `${BASE}movies/m1/artwork/old-thumb.png`,
      project: { status: ProjectStatus.IN_PRODUCTION },
    });

    const { thumbnailUrl } = await service.uploadThumbnail('e1', file('thumb.png'), reviewer);

    expect(tx.episode.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { thumbnailUrl } });
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'Episode' }), tx);
    expect(storage.remove).toHaveBeenCalledWith('movies/m1/artwork/old-thumb.png', 'public');
  });
});
