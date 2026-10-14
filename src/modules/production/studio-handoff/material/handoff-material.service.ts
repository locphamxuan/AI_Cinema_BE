import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { HandoffMaterialKind } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { detectKind, FILE_KINDS, safeFileName } from 'src/common/validation/uploaded-file';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';

/** BR-59: at most 50 MB per file (the table has the same CHECK) and 10 files per hand-off. */
export const MATERIAL_MAX_BYTES = 50 * 1024 * 1024;
export const MATERIAL_MAX_FILES = 10;
const MATERIAL_KINDS = [
  FILE_KINDS.pdf,
  FILE_KINDS.docx,
  FILE_KINDS.txt,
  FILE_KINDS.png,
  FILE_KINDS.jpeg,
  FILE_KINDS.webp,
];

/** The files of a hand-off request, by the multipart field they came in. */
export interface MaterialUploads {
  scripts?: Express.Multer.File[];
  references?: Express.Multer.File[];
}

export interface StoredMaterial {
  kind: HandoffMaterialKind;
  fileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: bigint;
}

/** Files that travel with a hand-off besides the brief: the script and reference material (BR-59). */
@Injectable()
export class HandoffMaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly storage: ObjectStorage,
  ) {}

  /** Validates and stores every file; the caller records them with the hand-off and calls discard() if that fails. */
  async store(movieId: string, uploads: MaterialUploads): Promise<StoredMaterial[]> {
    const files = [
      ...(uploads.scripts ?? []).map((file) => ({ file, kind: HandoffMaterialKind.SCRIPT })),
      ...(uploads.references ?? []).map((file) => ({ file, kind: HandoffMaterialKind.REFERENCE })),
    ];
    const stored: StoredMaterial[] = [];
    try {
      for (const { file, kind } of files) {
        const fileName = safeFileName(file.originalname);
        if (!file.size) throw new BadRequestException(`${fileName} is empty`);
        const detected = detectKind(fileName, file.buffer.subarray(0, 16), MATERIAL_KINDS);
        const storageKey = `movies/${movieId}/materials/${randomUUID()}${fileName.slice(fileName.lastIndexOf('.')).toLowerCase()}`;
        await this.storage.putBuffer(storageKey, file.buffer, detected.mimeType, 'private');
        stored.push({ kind, fileName, storageKey, mimeType: detected.mimeType, sizeBytes: BigInt(file.size) });
      }
    } catch (error) {
      await this.discard(stored);
      throw error;
    }
    return stored;
  }

  async discard(materials: StoredMaterial[]): Promise<void> {
    await Promise.all(
      materials.map(({ storageKey }) => this.storage.remove(storageKey, 'private').catch(() => undefined)),
    );
  }

  async download(movieId: string, handoffId: string, materialId: string, user: AuthenticatedUser) {
    await this.access.movie(movieId, user, 'read');
    const material = await this.prisma.studioHandoffMaterial.findFirst({
      where: { id: materialId, handoffId, handoff: { movieId } },
    });
    if (!material) throw new NotFoundException('Material not found');
    return new StreamableFile(await this.storage.stream(material.storageKey, 'private'), {
      type: material.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(material.fileName)}`,
      length: Number(material.sizeBytes),
    });
  }
}
