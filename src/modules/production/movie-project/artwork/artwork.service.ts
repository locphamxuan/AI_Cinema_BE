import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { detectKind, FILE_KINDS, safeFileName } from 'src/common/validation/uploaded-file';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus } from 'src/modules/production/project-access/project-rules';
import { EDITABLE_PROJECT_STATUSES } from '../project-status';

/** Posters and episode thumbnails: any raster image a browser shows (PNG, JPEG, WebP, GIF, BMP, AVIF), at most 20 MB. */
export const ARTWORK_MAX_BYTES = 20 * 1024 * 1024;
const ARTWORK_KINDS = [
  FILE_KINDS.png,
  FILE_KINDS.jpeg,
  FILE_KINDS.webp,
  FILE_KINDS.gif,
  FILE_KINDS.bmp,
  FILE_KINDS.avif,
];

/** The poster of a project and the thumbnail of an episode, which the Reviewer uploads (§4.1.10). */
@Injectable()
export class ArtworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly storage: ObjectStorage,
    private readonly auditLog: AuditLogService,
  ) {}

  async uploadPoster(movieId: string, file: Express.Multer.File | undefined, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'reviewer');
    assertProjectStatus(movie.status, EDITABLE_PROJECT_STATUSES, 'change the poster');
    const posterUrl = await this.store(`movies/${movieId}/artwork`, file);
    await this.prisma.$transaction(async (tx) => {
      await tx.movie.update({ where: { id: movieId }, data: { posterUrl } });
      await this.record(tx, movieId, movieId, user.id, 'poster');
    });
    await this.dropOld(movie.posterUrl);
    return { posterUrl };
  }

  async uploadThumbnail(episodeId: string, file: Express.Multer.File | undefined, user: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, user, 'reviewer');
    assertProjectStatus(episode.movie.status, EDITABLE_PROJECT_STATUSES, 'change the thumbnail');
    const thumbnailUrl = await this.store(`movies/${episode.movieId}/artwork`, file);
    await this.prisma.$transaction(async (tx) => {
      await tx.episode.update({ where: { id: episodeId }, data: { thumbnailUrl } });
      await this.record(tx, episode.movieId, episodeId, user.id, 'thumbnail');
    });
    await this.dropOld(episode.thumbnailUrl);
    return { thumbnailUrl };
  }

  private async store(folder: string, file: Express.Multer.File | undefined): Promise<string> {
    if (!file?.size) throw new BadRequestException('Attach an image in the "file" field');
    const fileName = safeFileName(file.originalname);
    const kind = detectKind(fileName, file.buffer.subarray(0, 16), ARTWORK_KINDS);
    const key = `${folder}/${randomUUID()}${kind.extensions[0]}`;
    await this.storage.putBuffer(key, file.buffer, kind.mimeType, 'public');
    return this.storage.publicUrl(key);
  }

  /** Removes the image an upload replaces, when it is one of ours. */
  private async dropOld(url: string | null): Promise<void> {
    const prefix = this.storage.publicUrl('x').slice(0, -1);
    if (!url?.startsWith(prefix)) return;
    await this.storage.remove(url.slice(prefix.length), 'public').catch(() => undefined);
  }

  private record(tx: PrismaTx, movieId: string, entityId: string, actorId: string, kind: 'poster' | 'thumbnail') {
    return this.auditLog.record(
      {
        action: CONTENT_EVENT.PROJECT_UPDATED,
        entityType: kind === 'poster' ? 'Movie' : 'Episode',
        entityId,
        movieId,
        actorId,
        payload: { fields: [kind] },
      },
      tx,
    );
  }
}
