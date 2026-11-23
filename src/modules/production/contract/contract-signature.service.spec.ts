import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ContractDocumentSide } from '@prisma/client';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { ContractSignatureService } from './contract-signature.service';
import type { ContractTemplateService } from './template/contract-template.service';
import { pngImage } from './template/template.fixtures';

const upload = (buffer: Buffer, originalname = 'chu-ky.png') =>
  ({ buffer, originalname, size: buffer.length }) as Express.Multer.File;

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
  const templates = {
    signer: jest.fn(),
    signedCopy: jest.fn(),
  };
  const tx = {
    contractSignature: { create: jest.fn(), findUnique: jest.fn() },
    contractDocument: { create: jest.fn() },
    contract: { findUniqueOrThrow: jest.fn() },
  };
  const service = new ContractSignatureService(
    storage as unknown as ObjectStorage,
    templates as unknown as ContractTemplateService,
  );
  const documents = () => tx.contractDocument.create.mock.calls.map(([arg]) => (arg as { data: never }).data);

  beforeEach(() => {
    jest.clearAllMocks();
    objects.clear();
    templates.signer.mockResolvedValue({ name: 'Nguyễn Thị Lan', title: 'Giám đốc' });
    templates.signedCopy.mockImplementation((_tx: unknown, _id: string, stamps: { side: string }[]) =>
      Promise.resolve(Buffer.from(`%PDF ${stamps.map((s) => s.side).join('+')}`)),
    );
    tx.contract.findUniqueOrThrow.mockResolvedValue({ round: 2 });
    tx.contractSignature.findUnique.mockResolvedValue(null);
  });

  it('checks the signature image and stores it under an unguessable private key before the transaction', async () => {
    const image = pngImage();
    const prepared = await service.prepare('p1', ContractDocumentSide.STUDIO, upload(image));

    expect(prepared.image.storageKey).toMatch(/^contracts\/p1\/signature-studio-[0-9a-f-]{36}\.png$/);
    expect(prepared.image).toMatchObject({ mimeType: 'image/png', width: 300, height: 100 });
    expect(prepared.image.checksum).toBe(createHash('sha256').update(image).digest('hex'));
    expect(storage.putBuffer).toHaveBeenCalledWith(prepared.image.storageKey, image, 'image/png', 'private');
    expect(prepared.written).toEqual([prepared.image.storageKey]);
  });

  it('refuses a missing file or one that is not a signature image, and stores nothing', async () => {
    await expect(service.prepare('p1', ContractDocumentSide.ADMIN, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.prepare('p1', ContractDocumentSide.ADMIN, upload(Buffer.from('%PDF-1.7 signed'), 'hop-dong.pdf')),
    ).rejects.toThrow(/must be one of \.png, \.jpg, \.jpeg/);
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  it('records the signature with its signer and stores the copy carrying it', async () => {
    const prepared = await service.prepare('p1', ContractDocumentSide.STUDIO, upload(pngImage()));

    await service.attach(tx as never, 'c1', prepared, 'u1', false);

    expect(tx.contractSignature.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 'c1',
        side: 'STUDIO',
        signerName: 'Nguyễn Thị Lan',
        signerTitle: 'Giám đốc',
        uploadedById: 'u1',
        signedAt: prepared.signedAt,
      }),
    });
    expect(templates.signer).toHaveBeenCalledWith(tx, 'c1', 'STUDIO');
    expect(documents()).toEqual([
      expect.objectContaining({
        side: 'STUDIO',
        fileName: 'hop-dong-studio-da-ky-vong-2.pdf',
        mimeType: 'application/pdf',
        uploadedById: 'u1',
      }),
    ]);
    expect(prepared.written).toHaveLength(2);
    expect(objects.get(prepared.written[1])!.toString()).toBe('%PDF STUDIO');
  });

  it('renders the FINAL copy with both signatures when the second side signs', async () => {
    objects.set('contracts/p1/signature-studio-x.png', pngImage());
    tx.contractSignature.findUnique.mockResolvedValue({
      side: 'STUDIO',
      storageKey: 'contracts/p1/signature-studio-x.png',
      signerName: 'Lan',
      signerTitle: 'Giám đốc',
      signedAt: new Date('2026-11-20T03:00:00Z'),
    });
    const prepared = await service.prepare('p1', ContractDocumentSide.ADMIN, upload(pngImage()));

    await service.attach(tx as never, 'c1', prepared, 'admin', true);

    expect(tx.contractSignature.findUnique).toHaveBeenCalledWith({
      where: { contractId_side: { contractId: 'c1', side: 'STUDIO' } },
    });
    expect(documents().map((d: { side: string; uploadedById: string | null }) => [d.side, d.uploadedById])).toEqual([
      ['ADMIN', 'admin'],
      ['FINAL', null],
    ]);
    expect(objects.get(prepared.written[2])!.toString()).toBe('%PDF ADMIN+STUDIO');
  });

  it('refuses to complete a round the other side has not signed', async () => {
    const prepared = await service.prepare('p1', ContractDocumentSide.ADMIN, upload(pngImage()));
    await expect(service.attach(tx as never, 'c1', prepared, 'admin', true)).rejects.toBeInstanceOf(ConflictException);
  });

  it('takes back every object it wrote when the signing transaction failed', async () => {
    const prepared = await service.prepare('p1', ContractDocumentSide.STUDIO, upload(pngImage()));
    await service.attach(tx as never, 'c1', prepared, 'u1', false);
    expect(objects.size).toBe(2);

    await service.discard(prepared);

    expect(objects.size).toBe(0);
  });
});
