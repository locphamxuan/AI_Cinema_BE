import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { ContractDocumentSide } from '@prisma/client';
import { detectKind, FILE_KINDS, safeFileName } from 'src/common/validation/uploaded-file';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { unicodeFontPath } from 'src/infrastructure/pdf/unicode-font';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { removeQuietly } from 'src/infrastructure/storage/remove-quietly';
import { assertUsableCounterpart, mergeSignedCounterparts, type SignedSummary } from './contract-pdf';
import type { Detailed } from './contract-rounds';

/** BR-13 sizing: a signed contract is a short document, 10 MB is already generous for a scan. */
export const CONTRACT_PDF_MAX_BYTES = 10 * 1024 * 1024;

/** A counterpart written to private storage, waiting for its row to be created in the signing transaction. */
export interface StoredPdf {
  side: ContractDocumentSide;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
  checksum: string;
}

/** What one side's upload produced: its own counterpart and, when it completed the round, the merged document. */
export interface PreparedSignature {
  signedAt: Date;
  counterpart: StoredPdf;
  final: StoredPdf | null;
}

export interface SignatureRequest {
  contract: Detailed;
  side: ContractDocumentSide;
  /** True when this upload is the second signature of the round, so the final document is built now. */
  completes: boolean;
  /** Name printed on the closing page of the merged document for the side signing now. */
  signerName: string;
  /** The cost both sides agreed on; only read when the round is completed. */
  costVnd: bigint | null;
}

/**
 * MF-1 (10/11/2026): the signatures of a contract are PDFs, not clicks. This service validates a side's
 * uploaded counterpart, stores it privately, and — when it is the second one — merges both into one final
 * document carrying the two signatures. Storage is written before the signing transaction and rolled back
 * with `discard` if that transaction fails, so the database never points at an object that is not there.
 */
@Injectable()
export class ContractSignatureService {
  private readonly fontPath: string | null;

  constructor(
    private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.fontPath = unicodeFontPath(config.briefFontPath);
  }

  /** Validates the upload, stores it, and builds the final document when it completes the round. */
  async prepare(request: SignatureRequest, file: Express.Multer.File | undefined, tx: PrismaTx) {
    const { contract, side, completes } = request;
    const signedAt = new Date();
    const counterpart = await this.store(contract.projectId, side, file);
    if (!completes) return { signedAt, counterpart, final: null } satisfies PreparedSignature;
    try {
      const final = await this.merge(tx, request, counterpart, signedAt);
      return { signedAt, counterpart, final } satisfies PreparedSignature;
    } catch (error) {
      await removeQuietly(this.storage, counterpart.storageKey, 'private');
      throw error;
    }
  }

  /** Writes the rows of what `prepare` stored; call inside the signing transaction. */
  async attach(tx: PrismaTx, contractId: string, prepared: PreparedSignature, uploadedById: string): Promise<void> {
    const rows = [
      { ...prepared.counterpart, uploadedById },
      ...(prepared.final ? [{ ...prepared.final, uploadedById: null }] : []),
    ];
    for (const { side, storageKey, fileName, sizeBytes, checksum, uploadedById: author } of rows) {
      await tx.contractDocument.create({
        data: {
          contractId,
          side,
          storageKey,
          fileName,
          mimeType: FILE_KINDS.pdf.mimeType,
          sizeBytes: BigInt(sizeBytes),
          checksum,
          uploadedById: author,
          uploadedAt: prepared.signedAt,
        },
      });
    }
  }

  /** Takes back the objects a failed signing transaction left behind. */
  async discard(prepared: PreparedSignature): Promise<void> {
    for (const stored of [prepared.counterpart, prepared.final]) {
      if (stored) await removeQuietly(this.storage, stored.storageKey, 'private');
    }
  }

  private async store(
    projectId: string,
    side: ContractDocumentSide,
    file: Express.Multer.File | undefined,
  ): Promise<StoredPdf> {
    if (!file?.buffer?.length) throw new BadRequestException('Attach the signed contract PDF in the "file" field');
    if (file.buffer.length > CONTRACT_PDF_MAX_BYTES) {
      throw new BadRequestException(`The signed contract PDF must be at most ${CONTRACT_PDF_MAX_BYTES} bytes`);
    }
    const fileName = safeFileName(file.originalname);
    detectKind(fileName, file.buffer.subarray(0, 16), [FILE_KINDS.pdf]);
    await assertUsableCounterpart(file.buffer, side === ContractDocumentSide.ADMIN ? 'Admin' : 'Studio');
    return this.write(projectId, side, fileName, file.buffer);
  }

  /** Both counterparts of the agreed cost are in: one final PDF holds the two signatures. */
  private async merge(
    tx: PrismaTx,
    request: SignatureRequest,
    counterpart: StoredPdf,
    signedAt: Date,
  ): Promise<StoredPdf> {
    const { contract, side, signerName, costVnd } = request;
    const other = side === ContractDocumentSide.ADMIN ? ContractDocumentSide.STUDIO : ContractDocumentSide.ADMIN;
    const earlier = await tx.contractDocument.findUnique({
      where: { contractId_side: { contractId: contract.id, side: other } },
      select: { storageKey: true },
    });
    if (!earlier) {
      throw new ConflictException('The other side has no signed PDF on this round; it must be uploaded again');
    }
    const earlierBytes = await this.storage.read(earlier.storageKey, 'private');
    const mine = await this.storage.read(counterpart.storageKey, 'private');
    const byAdmin = side === ContractDocumentSide.ADMIN;
    const summary: SignedSummary = {
      contractId: contract.id,
      round: contract.round,
      movieTitle: contract.project.movie.title,
      studioName: contract.studio.name,
      costVnd: costVnd ?? 0n,
      adminName: byAdmin ? signerName : (contract.adminSignedBy?.fullName ?? 'AI Cinema'),
      adminSignedAt: byAdmin ? signedAt : (contract.adminSignedAt ?? signedAt),
      studioSignedAt: byAdmin ? (contract.studioSignedAt ?? signedAt) : signedAt,
    };
    const merged = await mergeSignedCounterparts(
      { admin: byAdmin ? mine : earlierBytes, studio: byAdmin ? earlierBytes : mine },
      summary,
      this.fontPath,
    );
    return this.write(
      contract.projectId,
      ContractDocumentSide.FINAL,
      `hop-dong-du-chu-ky-vong-${contract.round}.pdf`,
      merged,
    );
  }

  /** Private object with an unguessable key: knowing the project is not enough to reach a contract PDF. */
  private async write(
    projectId: string,
    side: ContractDocumentSide,
    fileName: string,
    body: Buffer,
  ): Promise<StoredPdf> {
    const storageKey = `contracts/${projectId}/${side.toLowerCase()}-${randomUUID()}.pdf`;
    await this.storage.putBuffer(storageKey, body, FILE_KINDS.pdf.mimeType, 'private');
    return {
      side,
      storageKey,
      fileName,
      sizeBytes: body.length,
      checksum: createHash('sha256').update(body).digest('hex'),
    };
  }
}
