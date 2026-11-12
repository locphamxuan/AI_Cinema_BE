import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ContractDocumentSide } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import type { AppConfig } from 'src/config/app-config';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { Detailed } from './contract-rounds';
import { CONTRACT_PDF_MAX_BYTES, ContractSignatureService } from './contract-signature.service';

const pdf = async (pages = 1): Promise<Buffer> => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
};

const upload = (buffer: Buffer, originalname = 'hop-dong-da-ky.pdf') =>
  ({ buffer, originalname, size: buffer.length }) as Express.Multer.File;

const CONTRACT = {
  id: 'c1',
  projectId: 'p1',
  round: 1,
  costVnd: 170_000_000n,
  adminSignedAt: null,
  studioSignedAt: null,
  adminSignedBy: null,
  project: { movie: { title: 'Giấc Mơ Số' } },
  studio: { id: 's1', name: 'Lumen Studio' },
} as unknown as Detailed;

describe('ContractSignatureService', () => {
  const objects = new Map<string, Buffer>();
  const storage = {
    putBuffer: jest.fn((key: string, body: Buffer) => {
      objects.set(key, body);
      return Promise.resolve();
    }),
    read: jest.fn((key: string) => Promise.resolve(objects.get(key)!)),
    remove: jest.fn((key: string) => {
      objects.delete(key);
      return Promise.resolve();
    }),
  };
  const tx = { contractDocument: { findUnique: jest.fn(), create: jest.fn() } };
  const service = new ContractSignatureService(
    storage as unknown as ObjectStorage,
    {
      briefFontPath: null,
    } as unknown as AppConfig,
  );
  const prepare = (side: ContractDocumentSide, completes: boolean, file?: Express.Multer.File) =>
    service.prepare(
      { contract: CONTRACT, side, completes, signerName: 'Nguyễn Văn A', costVnd: CONTRACT.costVnd },
      file,
      tx as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    objects.clear();
    tx.contractDocument.findUnique.mockResolvedValue(null);
  });

  it('stores a signed PDF under an unguessable private key and records its checksum', async () => {
    const file = await pdf();
    const prepared = await prepare(ContractDocumentSide.STUDIO, false, upload(file));

    expect(prepared.final).toBeNull();
    expect(prepared.counterpart.storageKey).toMatch(/^contracts\/p1\/studio-[0-9a-f-]{36}\.pdf$/);
    expect(prepared.counterpart.checksum).toBe(createHash('sha256').update(file).digest('hex'));
    expect(prepared.counterpart.fileName).toBe('hop-dong-da-ky.pdf');
    expect(storage.putBuffer).toHaveBeenCalledWith(prepared.counterpart.storageKey, file, 'application/pdf', 'private');
  });

  it('refuses a missing file, a file that is not a PDF, and one over the size limit', async () => {
    await expect(prepare(ContractDocumentSide.ADMIN, false, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      prepare(ContractDocumentSide.ADMIN, false, upload(Buffer.from('not a pdf at all'), 'ke-hoach.pdf')),
    ).rejects.toThrow(/must be one of \.pdf/);
    // A real PDF renamed to .txt is refused too: the extension and the content must agree.
    await expect(prepare(ContractDocumentSide.ADMIN, false, upload(await pdf(), 'hop-dong.txt'))).rejects.toThrow(
      /must be one of \.pdf/,
    );
    const huge = upload(Buffer.alloc(CONTRACT_PDF_MAX_BYTES + 1, 1));
    await expect(prepare(ContractDocumentSide.ADMIN, false, huge)).rejects.toThrow(/at most/);
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  it('merges both counterparts into one final document when the second side signs', async () => {
    const studioKey = 'contracts/p1/studio-already-there.pdf';
    objects.set(studioKey, await pdf(2));
    tx.contractDocument.findUnique.mockResolvedValue({ storageKey: studioKey });

    const prepared = await prepare(ContractDocumentSide.ADMIN, true, upload(await pdf(3)));

    expect(prepared.final).not.toBeNull();
    expect(prepared.final!.side).toBe(ContractDocumentSide.FINAL);
    expect(prepared.final!.fileName).toBe('hop-dong-du-chu-ky-vong-1.pdf');
    const merged = await PDFDocument.load(objects.get(prepared.final!.storageKey)!, { updateMetadata: false });
    // 3 Admin pages + 2 studio pages + the closing page naming both signatures.
    expect(merged.getPageCount()).toBe(6);
  });

  it('refuses to complete a round whose other counterpart is missing, and keeps no orphan behind', async () => {
    await expect(prepare(ContractDocumentSide.ADMIN, true, upload(await pdf()))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(objects.size).toBe(0);
  });

  it('writes one row per stored PDF, the merged one with no uploader', async () => {
    const prepared = await prepare(ContractDocumentSide.STUDIO, false, upload(await pdf()));
    await service.attach(tx as never, 'c9', { ...prepared, final: { ...prepared.counterpart, side: 'FINAL' } }, 'u1');

    const [first, second] = tx.contractDocument.create.mock.calls as [{ data: never }][];
    expect(first[0]).toMatchObject({
      data: { contractId: 'c9', side: ContractDocumentSide.STUDIO, uploadedById: 'u1', mimeType: 'application/pdf' },
    });
    expect(second[0]).toMatchObject({ data: { side: 'FINAL', uploadedById: null } });
  });

  it('takes its objects back when the signing transaction failed', async () => {
    const prepared = await prepare(ContractDocumentSide.STUDIO, false, upload(await pdf()));
    expect(objects.size).toBe(1);
    await service.discard(prepared);
    expect(objects.size).toBe(0);
  });
});
