import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { ContractDocumentSide } from '@prisma/client';
import { FILE_KINDS } from 'src/common/validation/uploaded-file';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { removeQuietly } from 'src/infrastructure/storage/remove-quietly';
import { readSignatureImage, type SignatureImage } from './signature-image';
import type { ContractSide, SignatureStamp } from './template/contract-template-pdf';
import { contractNo, ContractTemplateService } from './template/contract-template.service';

/** One party of a contract: ADMIN (Bên A) or STUDIO (Bên B); FINAL is the system's copy, never a signer. */
export type SigningSide = typeof ContractDocumentSide.ADMIN | typeof ContractDocumentSide.STUDIO;

/** A signature image validated and written to private storage, waiting for the signing transaction. */
export interface PreparedSignature {
  projectId: string;
  side: SigningSide;
  signedAt: Date;
  image: SignatureImage & { storageKey: string; checksum: string };
  /** Every object written for this signing, taken back by `discard` if the transaction fails. */
  written: string[];
}

const COPY_NAMES: Record<ContractDocumentSide, string> = {
  ADMIN: 'hop-dong-ai-cinema-da-ky',
  STUDIO: 'hop-dong-studio-da-ky',
  FINAL: 'hop-dong-du-chu-ky',
};

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const otherSide = (side: SigningSide): SigningSide =>
  side === ContractDocumentSide.ADMIN ? ContractDocumentSide.STUDIO : ContractDocumentSide.ADMIN;

/**
 * MF-1 signing by signature image (22/11/2026): each side uploads a picture of its signature; the system draws it
 * into that side's block of the very contract template the unsigned copy is rendered from, so the studio-signed
 * and the FINAL copies have exactly its layout. `prepare` checks and stores the image before the signing
 * transaction; `attach` records it and renders the signed copies inside it; `discard` takes back every object a
 * failed transaction left, so the database never points at an object that is not there and vice versa.
 */
@Injectable()
export class ContractSignatureService {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly templates: ContractTemplateService,
  ) {}

  /** Validates the uploaded image (400 otherwise) and stores it privately. */
  async prepare(projectId: string, side: SigningSide, file: Express.Multer.File | undefined) {
    const image = await readSignatureImage(file);
    const storageKey = `contracts/${projectId}/signature-${side.toLowerCase()}-${randomUUID()}.${image.extension}`;
    await this.storage.putBuffer(storageKey, image.buffer, image.mimeType, 'private');
    const prepared: PreparedSignature = {
      projectId,
      side,
      signedAt: new Date(),
      image: { ...image, storageKey, checksum: sha256(image.buffer) },
      written: [storageKey],
    };
    return prepared;
  }

  /**
   * Before a side completes a round: the other side's signature image must be on record, or there is nothing to draw
   * beside it. Only a round signed before signature images (22/11/2026) lacks it; such rounds are re-opened by the
   * migration 20261124100000, so this is the clear 409 left for any that slipped through.
   */
  async assertCounterpartSigned(db: PrismaTx, contractId: string, side: SigningSide): Promise<void> {
    const other = await db.contractSignature.findUnique({
      where: { contractId_side: { contractId, side: otherSide(side) } },
      select: { id: true },
    });
    if (other) return;
    throw new ConflictException({
      message: "The other side's signature image of this round is missing; the round must be sent again",
      details: { reason: 'COUNTERPART_SIGNATURE_MISSING', contractId },
    });
  }

  /**
   * Inside the signing transaction, once the round the signature belongs to exists: records the signature and
   * stores the copy carrying it; when it is the second signature of the round, also the FINAL copy with both.
   */
  async attach(
    tx: PrismaTx,
    contractId: string,
    prepared: PreparedSignature,
    uploadedById: string,
    completes: boolean,
  ): Promise<void> {
    const { side, signedAt, image } = prepared;
    const signer = await this.templates.signer(tx, contractId, side);
    await tx.contractSignature.create({
      data: {
        contractId,
        side,
        storageKey: image.storageKey,
        mimeType: image.mimeType,
        sizeBytes: image.buffer.length,
        width: image.width,
        height: image.height,
        checksum: image.checksum,
        signerName: signer.name,
        signerTitle: signer.title,
        signedAt,
        uploadedById,
      },
    });
    const mine: SignatureStamp = {
      side: side,
      image: image.buffer,
      signerName: signer.name,
      signerTitle: signer.title,
      signedAt,
    };
    await this.storeCopy(tx, contractId, prepared, side, [mine], uploadedById);
    if (!completes) return;
    await this.assertCounterpartSigned(tx, contractId, side);
    const other = await tx.contractSignature.findUniqueOrThrow({
      where: { contractId_side: { contractId, side: otherSide(side) } },
    });
    const theirs: SignatureStamp = {
      side: other.side as ContractSide,
      image: await this.storage.read(other.storageKey, 'private'),
      signerName: other.signerName,
      signerTitle: other.signerTitle,
      signedAt: other.signedAt,
    };
    await this.storeCopy(tx, contractId, prepared, ContractDocumentSide.FINAL, [mine, theirs], null);
  }

  /** Takes back the objects a failed signing transaction left behind. */
  async discard(prepared: PreparedSignature): Promise<void> {
    for (const key of prepared.written) await removeQuietly(this.storage, key, 'private');
  }

  /** Renders the contract with the given signatures, stores it under an unguessable key and records it. */
  private async storeCopy(
    tx: PrismaTx,
    contractId: string,
    prepared: PreparedSignature,
    side: ContractDocumentSide,
    stamps: SignatureStamp[],
    uploadedById: string | null,
  ): Promise<void> {
    const body = await this.templates.signedCopy(tx, contractId, stamps);
    const storageKey = `contracts/${prepared.projectId}/${side.toLowerCase()}-${randomUUID()}.pdf`;
    await this.storage.putBuffer(storageKey, body, FILE_KINDS.pdf.mimeType, 'private');
    prepared.written.push(storageKey);
    const contract = await tx.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { id: true, round: true, createdAt: true },
    });
    await tx.contractDocument.create({
      data: {
        contractId,
        side,
        storageKey,
        fileName: `${COPY_NAMES[side]}-${contractNo(contract)}.pdf`,
        mimeType: FILE_KINDS.pdf.mimeType,
        sizeBytes: BigInt(body.length),
        checksum: sha256(body),
        uploadedById,
        uploadedAt: prepared.signedAt,
      },
    });
  }
}
