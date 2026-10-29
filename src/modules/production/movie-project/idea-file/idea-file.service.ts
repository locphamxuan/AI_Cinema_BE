import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { BadRequestException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import type { IdeaFilePurpose } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { detectKind, FILE_KINDS, safeFileName } from 'src/common/validation/uploaded-file';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';

/** BR-12: documents, UTF-8 TXT, images or video, at most 100 MB each. */
export const IDEA_FILE_MAX_BYTES = 100 * 1024 * 1024;
const IDEA_FILE_KINDS = [
  FILE_KINDS.pdf,
  FILE_KINDS.docx,
  FILE_KINDS.doc,
  FILE_KINDS.rtf,
  FILE_KINDS.xlsx,
  FILE_KINDS.pptx,
  FILE_KINDS.txt,
  FILE_KINDS.png,
  FILE_KINDS.jpeg,
  FILE_KINDS.webp,
  FILE_KINDS.gif,
  FILE_KINDS.bmp,
  FILE_KINDS.avif,
  FILE_KINDS.mp4,
  FILE_KINDS.mov,
  FILE_KINDS.webm,
  FILE_KINDS.avi,
];

function isUtf8Text(file: Buffer): boolean {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (let offset = 0; offset < file.length; offset += 64 * 1024) {
      const chunk = file.subarray(offset, offset + 64 * 1024);
      if (chunk.includes(0)) return false;
      decoder.decode(chunk, { stream: offset + chunk.length < file.length });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}

/** Idea files the Reviewer attaches to the project; they travel with the studio brief. */
@Injectable()
export class IdeaFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly storage: ObjectStorage,
    private readonly auditLog: AuditLogService,
  ) {}

  async upload(
    projectId: string,
    file: Express.Multer.File | undefined,
    user: AuthenticatedUser,
    purpose: IdeaFilePurpose = 'IDEA',
  ) {
    if (!file?.buffer.length) throw new BadRequestException('Attach a file in the "file" field');
    const project = await this.access.project(projectId, user, 'reviewer');
    assertProjectStatus(project.status, OPEN_PROJECT_STATUSES, 'add idea files');
    const fileName = safeFileName(file.originalname);
    if (fileName.toLowerCase().endsWith('.txt') && !isUtf8Text(file.buffer)) {
      throw new BadRequestException('TXT idea files must contain valid UTF-8 plain text');
    }
    const kind = detectKind(fileName, file.buffer.subarray(0, 16), IDEA_FILE_KINDS);

    const storageKey = `movies/${projectId}/ideas/${randomUUID()}${fileName.slice(fileName.lastIndexOf('.')).toLowerCase()}`;
    await this.storage.putBuffer(storageKey, file.buffer, kind.mimeType, 'private');

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM movie_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      const last = await tx.movieIdeaFile.aggregate({ where: { projectId, fileName }, _max: { version: true } });
      const created = await tx.movieIdeaFile.create({
        data: {
          projectId,
          fileName,
          purpose,
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
          projectId,
          actorId: user.id,
          payload: { fileName, purpose, version: created.version },
        },
        tx,
      );
      return created;
    });
  }

  async list(projectId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    return this.prisma.movieIdeaFile.findMany({
      where: { projectId },
      orderBy: [{ fileName: 'asc' }, { version: 'desc' }],
    });
  }

  /** The Reviewer takes a file version off an open project; the stored object goes with it. */
  async remove(projectId: string, fileId: string, user: AuthenticatedUser): Promise<void> {
    const project = await this.access.project(projectId, user, 'reviewer');
    assertProjectStatus(project.status, OPEN_PROJECT_STATUSES, 'remove idea files');
    const file = await this.prisma.movieIdeaFile.findFirst({ where: { id: fileId, projectId } });
    if (!file) throw new NotFoundException('Idea file not found');
    await this.prisma.movieIdeaFile.delete({ where: { id: file.id } });
    await this.storage.remove(file.storageKey, 'private').catch(() => undefined);
  }

  async download(projectId: string, fileId: string, user: AuthenticatedUser): Promise<StreamableFile> {
    await this.access.project(projectId, user, 'read');
    const file = await this.prisma.movieIdeaFile.findFirst({ where: { id: fileId, projectId } });
    if (!file) throw new NotFoundException('Idea file not found');
    return new StreamableFile(await this.storage.stream(file.storageKey, 'private'), {
      type: file.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      length: Number(file.sizeBytes),
    });
  }
}
