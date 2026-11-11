import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';

/** Files earlier hand-offs sent with their brief (BR-59). Since 08/11/2026 nothing is attached but the brief PDF. */
@Injectable()
export class HandoffMaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly storage: ObjectStorage,
  ) {}

  async download(projectId: string, handoffId: string, materialId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    const material = await this.prisma.studioHandoffMaterial.findFirst({
      where: { id: materialId, handoffId, handoff: { projectId } },
    });
    if (!material) throw new NotFoundException('Material not found');
    return new StreamableFile(await this.storage.stream(material.storageKey, 'private'), {
      type: material.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(material.fileName)}`,
      length: Number(material.sizeBytes),
    });
  }
}
