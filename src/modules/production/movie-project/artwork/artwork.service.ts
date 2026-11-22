import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { detectKind, FILE_KINDS, safeFileName } from 'src/common/validation/uploaded-file';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { removeQuietly } from 'src/infrastructure/storage/remove-quietly';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus } from 'src/modules/production/project-access/project-rules';
import { EDITABLE_PROJECT_STATUSES } from '../project-status';

/** Posters and episode thumbnails: any raster image a browser shows (PNG, JPEG, WebP, GIF, BMP, AVIF), at most 20 MB. */
export const ARTWORK_MAX_BYTES = 20 * 1024 * 1024;
export const ARTWORK_KINDS = [
  FILE_KINDS.png,
  FILE_KINDS.jpeg,
  FILE_KINDS.webp,
  FILE_KINDS.gif,
  FILE_KINDS.bmp,
  FILE_KINDS.avif,
];

/** The poster of a project (the Reviewer in charge or the Admin) and the thumbnail of an episode (the Reviewer). */
@Injectable()
export class ArtworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly storage: ObjectStorage,
    private readonly auditLog: AuditLogService,
  ) {}

  async uploadPoster(projectId: string, file: Express.Multer.File | undefined, user: AuthenticatedUser) {
    // The Reviewer in charge, or the Admin who publishes (it puts up the poster the studio sent).
    const role = (await this.access.canPublish(user)) ? 'read' : 'reviewer';
    const project = await this.access.project(projectId, user, role);
    assertProjectStatus(project.status, EDITABLE_PROJECT_STATUSES, 'change the poster');
    const previous = await this.prisma.movie.findUniqueOrThrow({
      where: { id: projectId },
      select: { posterUrl: true },
    });
    const stored = await this.store(`movies/${projectId}/artwork`, file);
    const posterUrl = stored.url;
    await this.saveOrDiscard(stored.key, async (tx) => {
      await tx.movie.update({ where: { id: projectId }, data: { posterUrl } });
      await this.record(tx, projectId, projectId, user.id, 'poster');
    });
    await this.dropOld(previous.posterUrl);
    return { posterUrl };
  }

  async uploadThumbnail(episodeId: string, file: Express.Multer.File | undefined, user: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, user, 'reviewer');
    assertProjectStatus(episode.project.status, EDITABLE_PROJECT_STATUSES, 'change the thumbnail');
    const stored = await this.store(`movies/${episode.movieId}/artwork`, file);
    const thumbnailUrl = stored.url;
    await this.saveOrDiscard(stored.key, async (tx) => {
      await tx.episode.update({ where: { id: episodeId }, data: { thumbnailUrl } });
      await this.record(tx, episode.movieId, episodeId, user.id, 'thumbnail');
    });
    await this.dropOld(episode.thumbnailUrl);
    return { thumbnailUrl };
  }

  private async store(folder: string, file: Express.Multer.File | undefined): Promise<{ key: string; url: string }> {
    if (!file?.size) throw new BadRequestException('Attach an image in the "file" field');
    const fileName = safeFileName(file.originalname);
    const kind = detectKind(fileName, file.buffer.subarray(0, 16), ARTWORK_KINDS);
    const key = `${folder}/${randomUUID()}${kind.extensions[0]}`;
    await this.storage.putBuffer(key, file.buffer, kind.mimeType, 'public');
    return { key, url: this.storage.publicUrl(key) };
  }

  /** Writes the new link; when that fails, the image just stored would be an orphan, so it goes too. */
  private async saveOrDiscard(key: string, write: (tx: PrismaTx) => Promise<void>): Promise<void> {
    try {
      await this.prisma.$transaction(write);
    } catch (error) {
      await removeQuietly(this.storage, key, 'public');
      throw error;
    }
  }

  /** Removes the image an upload replaces, when it is one of ours. */
  private async dropOld(url: string | null): Promise<void> {
    const prefix = this.storage.publicUrl('x').slice(0, -1);
    if (!url?.startsWith(prefix)) return;
    await removeQuietly(this.storage, url.slice(prefix.length), 'public');
  }

  private record(tx: PrismaTx, projectId: string, entityId: string, actorId: string, kind: 'poster' | 'thumbnail') {
    return this.auditLog.record(
      {
        action: CONTENT_EVENT.PROJECT_UPDATED,
        entityType: kind === 'poster' ? 'Movie' : 'Episode',
        entityId,
        projectId,
        actorId,
        payload: { fields: [kind] },
      },
      tx,
    );
  }
}
