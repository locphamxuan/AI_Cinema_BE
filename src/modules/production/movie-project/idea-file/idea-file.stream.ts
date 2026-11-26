import { NotFoundException, StreamableFile } from '@nestjs/common';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';

/** An idea file of a project as a download; the caller has already checked who may read the project. */
export async function streamIdeaFile(
  prisma: PrismaService,
  storage: ObjectStorage,
  projectId: string,
  fileId: string,
): Promise<StreamableFile> {
  const file = await prisma.movieIdeaFile.findFirst({ where: { id: fileId, projectId } });
  if (!file) throw new NotFoundException('Idea file not found');
  return new StreamableFile(await storage.stream(file.storageKey, 'private'), {
    type: file.mimeType,
    disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    length: Number(file.sizeBytes),
  });
}
