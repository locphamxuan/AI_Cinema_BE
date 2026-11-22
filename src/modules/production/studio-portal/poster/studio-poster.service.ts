import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { BadRequestException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { detectKind, safeFileName } from 'src/common/validation/uploaded-file';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { removeQuietly } from 'src/infrastructure/storage/remove-quietly';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ARTWORK_KINDS } from 'src/modules/production/movie-project/artwork/artwork.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { StudioAccountService } from 'src/modules/production/studio/studio-account.service';
import { studioPosterOf } from './studio-poster.view';

/**
 * The poster image a studio sends with its film (22/11/2026). It is kept private: the Reviewer or the Admin
 * downloads it and sets it as the movie poster through the usual artwork upload.
 */
@Injectable()
export class StudioPosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly accounts: StudioAccountService,
    private readonly storage: ObjectStorage,
    private readonly auditLog: AuditLogService,
  ) {}

  async upload(projectId: string, file: Express.Multer.File | undefined, user: AuthenticatedUser) {
    const studioId = await this.accounts.studioOf(user);
    await this.access.studioProject(projectId, studioId);
    if (!file?.size) throw new BadRequestException('Attach an image in the "file" field');
    const fileName = safeFileName(file.originalname);
    const kind = detectKind(fileName, await headOf(file), ARTWORK_KINDS);
    const previous = await this.prisma.movieProject.findUniqueOrThrow({
      where: { id: projectId },
      select: { studioPosterKey: true },
    });
    const key = `movies/${projectId}/studio-poster/${randomUUID()}${kind.extensions[0]}`;
    if (file.path) await this.storage.putFile(key, file.path, kind.mimeType, 'private');
    else await this.storage.putBuffer(key, file.buffer, kind.mimeType, 'private');

    let saved: { studioPosterFileName: string | null; studioPosterUploadedAt: Date | null };
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const row = await tx.movieProject.update({
          where: { id: projectId },
          data: {
            studioPosterKey: key,
            studioPosterFileName: fileName,
            studioPosterMimeType: kind.mimeType,
            studioPosterUploadedAt: new Date(),
          },
          select: { studioPosterFileName: true, studioPosterUploadedAt: true },
        });
        await this.auditLog.record(
          {
            action: CONTENT_EVENT.STUDIO_POSTER_UPLOADED,
            entityType: 'MovieProject',
            entityId: projectId,
            projectId,
            actorId: user.id,
            payload: { fileName, studioId },
          },
          tx,
        );
        return row;
      });
    } catch (error) {
      await removeQuietly(this.storage, key, 'private');
      throw error;
    }
    if (previous.studioPosterKey) await removeQuietly(this.storage, previous.studioPosterKey, 'private');
    return { studioPoster: studioPosterOf(saved) };
  }

  /** The poster the studio sent, as a download for the Reviewer in charge or the Admin. */
  async download(projectId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    const project = await this.prisma.movieProject.findUniqueOrThrow({
      where: { id: projectId },
      select: { studioPosterKey: true, studioPosterFileName: true, studioPosterMimeType: true },
    });
    if (!project.studioPosterKey) throw new NotFoundException('The studio has not sent a poster yet');
    const fileName = project.studioPosterFileName ?? 'poster';
    return new StreamableFile(await this.storage.stream(project.studioPosterKey, 'private'), {
      type: project.studioPosterMimeType ?? 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }
}

/** The first bytes of the upload, from memory or from the temporary file a disk-storage interceptor wrote. */
async function headOf(file: Express.Multer.File): Promise<Buffer> {
  if (!file.path) return file.buffer.subarray(0, 16);
  const handle = await open(file.path, 'r');
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
