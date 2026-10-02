import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { detectKind, FILE_KINDS, safeFileName } from 'src/common/validation/uploaded-file';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';

/** BR-12: PDF, DOCX or images, at most 20 MB each. */
export const IDEA_FILE_MAX_BYTES = 20 * 1024 * 1024;
const IDEA_FILE_KINDS = [FILE_KINDS.pdf, FILE_KINDS.docx, FILE_KINDS.png, FILE_KINDS.jpeg, FILE_KINDS.webp];

/** Idea files the Reviewer attaches to the project; they travel with the studio brief. */
@Injectable()
export class IdeaFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly storage: ObjectStorage,
    private readonly auditLog: AuditLogService,
  ) {}

  async upload(movieId: string, file: Express.Multer.File | undefined, user: AuthenticatedUser) {
    if (!file?.buffer.length) throw new BadRequestException('Attach a file in the "file" field');
    const movie = await this.access.movie(movieId, user, 'reviewer');
    assertProjectStatus(movie.status, OPEN_PROJECT_STATUSES, 'add idea files');
    const fileName = safeFileName(file.originalname);
    const kind = detectKind(fileName, file.buffer.subarray(0, 16), IDEA_FILE_KINDS);

    const storageKey = `movies/${movieId}/ideas/${randomUUID()}${fileName.slice(fileName.lastIndexOf('.')).toLowerCase()}`;
    await this.storage.putBuffer(storageKey, file.buffer, kind.mimeType, 'private');

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM movies WHERE id = ${movieId}::uuid FOR UPDATE`;
      const last = await tx.movieIdeaFile.aggregate({ where: { movieId, fileName }, _max: { version: true } });
      const created = await tx.movieIdeaFile.create({
        data: {
          movieId,
          fileName,
          version: (last._max.version ?? 0) + 1,
          storageKey,
          mimeType: kind.mimeType,
          sizeBytes: BigInt(file.size),
          uploadedById: user.id,
        },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.IDEA_FILE_UPLOADED,
          entityType: 'MovieIdeaFile',
          entityId: created.id,
          movieId,
          actorId: user.id,
          payload: { fileName, version: created.version },
        },
        tx,
      );
      return created;
    });
  }

  async list(movieId: string, user: AuthenticatedUser) {
    await this.access.movie(movieId, user, 'read');
    return this.prisma.movieIdeaFile.findMany({
      where: { movieId },
      orderBy: [{ fileName: 'asc' }, { version: 'desc' }],
    });
  }

  async download(movieId: string, fileId: string, user: AuthenticatedUser): Promise<StreamableFile> {
    await this.access.movie(movieId, user, 'read');
    const file = await this.prisma.movieIdeaFile.findFirst({ where: { id: fileId, movieId } });
    if (!file) throw new NotFoundException('Idea file not found');
    return new StreamableFile(await this.storage.stream(file.storageKey, 'private'), {
      type: file.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      length: Number(file.sizeBytes),
    });
  }
}
