import { NotFoundException } from '@nestjs/common';
import { ContractDocumentSide, UserRole } from '@prisma/client';
import { Readable } from 'node:stream';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ContractDocumentService } from './contract-document.service';

const REVIEWER = { id: 'rev', role: UserRole.CONTENT_REVIEWER };
const DOCUMENT = {
  storageKey: 'contracts/p1/final-abc.pdf',
  fileName: 'hop-dong-du-chu-ky-vong-1.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048n,
};

describe('ContractDocumentService', () => {
  const prisma = {
    contract: { findUnique: jest.fn(), findFirst: jest.fn() },
    contractDocument: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const access = { project: jest.fn() };
  const storage = { stream: jest.fn() };
  const service = new ContractDocumentService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    storage as unknown as ObjectStorage,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.contract.findUnique.mockResolvedValue({ id: 'c1', projectId: 'p1' });
    prisma.contract.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.contractDocument.findUnique.mockResolvedValue(DOCUMENT);
    storage.stream.mockResolvedValue(Readable.from(['pdf']));
  });

  it('streams the merged document to someone who may read the project', async () => {
    const file = await service.download('c1', ContractDocumentSide.FINAL, REVIEWER);

    expect(access.project).toHaveBeenCalledWith('p1', REVIEWER, 'read');
    expect(storage.stream).toHaveBeenCalledWith(DOCUMENT.storageKey, 'private');
    expect(file.options.type).toBe('application/pdf');
    expect(file.options.disposition).toContain(encodeURIComponent(DOCUMENT.fileName));
  });

  it('never streams a project the caller may not read, and 404s an unknown contract', async () => {
    access.project.mockRejectedValue(new NotFoundException());
    await expect(service.download('c1', ContractDocumentSide.ADMIN, REVIEWER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.stream).not.toHaveBeenCalled();

    access.project.mockResolvedValue(undefined);
    prisma.contract.findUnique.mockResolvedValue(null);
    await expect(service.download('c9', ContractDocumentSide.ADMIN, REVIEWER)).rejects.toThrow('Contract not found');
  });

  it('lets the studio of the contract download its own round only', async () => {
    await expect(service.downloadForStudio('c1', ContractDocumentSide.STUDIO, 's1')).resolves.toBeDefined();
    expect(prisma.contract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', studioId: 's1' } }),
    );

    prisma.contract.findFirst.mockResolvedValue(null);
    await expect(service.downloadForStudio('c1', ContractDocumentSide.STUDIO, 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s a side that has not been uploaded yet', async () => {
    prisma.contractDocument.findUnique.mockResolvedValue(null);
    await expect(service.download('c1', ContractDocumentSide.FINAL, REVIEWER)).rejects.toThrow(/no such signed PDF/);
  });

  it('lists the metadata of a round without exposing storage keys', async () => {
    prisma.contractDocument.findMany.mockResolvedValue([{ side: 'ADMIN' }]);
    await expect(service.list('c1', REVIEWER)).resolves.toEqual([{ side: 'ADMIN' }]);
    const [{ select }] = prisma.contractDocument.findMany.mock.calls[0] as [{ select: Record<string, boolean> }];
    expect(select).not.toHaveProperty('storageKey');
  });
});
