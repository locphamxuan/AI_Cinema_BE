import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { ContractDocumentSide } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';

const METADATA = {
  id: true,
  side: true,
  fileName: true,
  sizeBytes: true,
  checksum: true,
  uploadedById: true,
  uploadedAt: true,
} as const;

/**
 * Reading the signed contract PDFs. The objects are private and have unguessable keys, so a download always
 * goes through here: the Admin and the Reviewer of the project reach them with contract:document.read, and
 * the studio of the contract reaches its own through /studio-portal. Nobody else, including other studios.
 */
@Injectable()
export class ContractDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly storage: ObjectStorage,
  ) {}

  /** What a round holds, without storage keys: the Admin's PDF, the studio's, and the merged final one. */
  async list(contractId: string, user: AuthenticatedUser) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, projectId: true },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    await this.access.project(contract.projectId, user, 'read');
    return this.prisma.contractDocument.findMany({
      where: { contractId },
      orderBy: { side: 'asc' },
      select: METADATA,
    });
  }

  /** Admin or the Reviewer in charge downloads one side's PDF, or the merged document. */
  async download(contractId: string, side: ContractDocumentSide, user: AuthenticatedUser): Promise<StreamableFile> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { projectId: true },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    await this.access.project(contract.projectId, user, 'read');
    return this.stream(contractId, side);
  }

  /** The studio of the contract downloads its own round; another studio gets a 404. */
  async downloadForStudio(contractId: string, side: ContractDocumentSide, studioId: string): Promise<StreamableFile> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, studioId },
      select: { id: true },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    return this.stream(contractId, side);
  }

  private async stream(contractId: string, side: ContractDocumentSide): Promise<StreamableFile> {
    const document = await this.prisma.contractDocument.findUnique({
      where: { contractId_side: { contractId, side } },
    });
    if (!document) throw new NotFoundException('That contract has no such signed PDF yet');
    return new StreamableFile(await this.storage.stream(document.storageKey, 'private'), {
      type: document.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      length: Number(document.sizeBytes),
    });
  }
}
