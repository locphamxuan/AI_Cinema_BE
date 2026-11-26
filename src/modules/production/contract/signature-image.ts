import { BadRequestException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { detectKind, FILE_KINDS } from 'src/common/validation/uploaded-file';

/** A signature is a small picture: 2 MB is already generous for a phone photo of one. */
export const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
/** Smaller than this cannot be read once printed in the signature block. */
export const SIGNATURE_MIN_SIZE = { width: 150, height: 50 };
/** Larger than this on either side is a whole-page scan, not a signature. */
export const SIGNATURE_MAX_SIDE = 4000;

const SIGNATURE_KINDS = [FILE_KINDS.png, FILE_KINDS.jpeg];

/** A signature image that passed every check, ready to be stored and drawn into the contract. */
export interface SignatureImage {
  buffer: Buffer;
  mimeType: string;
  extension: 'png' | 'jpg';
  width: number;
  height: number;
}

/** Width and height from the PNG IHDR chunk. */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Width and height from the first JPEG start-of-frame marker (SOF0-SOF15, except DHT/JPG/DAC). */
function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

/** Draws the image once on a throwaway page: what pdfkit cannot decode now would fail the signing later. */
function assertDrawable(buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [200, 100] });
      doc.on('data', () => undefined);
      doc.on('end', () => resolve());
      doc.on('error', reject);
      doc.image(buffer, 0, 0, { fit: [200, 100] });
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Checks the signature image one side uploads (MF-1, 22/11/2026): a PNG or JPEG whose content matches its name,
 * at most SIGNATURE_MAX_BYTES, and of a size that prints legibly in the signature block. 400 otherwise.
 */
export async function readSignatureImage(file: Express.Multer.File | undefined): Promise<SignatureImage> {
  if (!file?.buffer?.length)
    throw new BadRequestException('Attach the signature image (PNG or JPEG) in the "file" field');
  const { buffer } = file;
  if (buffer.length > SIGNATURE_MAX_BYTES) {
    throw new BadRequestException(`The signature image must be at most ${SIGNATURE_MAX_BYTES} bytes`);
  }
  const kind = detectKind(file.originalname ?? '', buffer.subarray(0, 16), SIGNATURE_KINDS);
  const png = kind === FILE_KINDS.png;
  const size = png ? pngSize(buffer) : jpegSize(buffer);
  if (!size) throw new BadRequestException('The signature image cannot be read; upload another PNG or JPEG');
  const { width, height } = size;
  if (width < SIGNATURE_MIN_SIZE.width || height < SIGNATURE_MIN_SIZE.height) {
    throw new BadRequestException(
      `The signature image is ${width}x${height} px; it must be at least ${SIGNATURE_MIN_SIZE.width}x${SIGNATURE_MIN_SIZE.height} px`,
    );
  }
  if (width > SIGNATURE_MAX_SIDE || height > SIGNATURE_MAX_SIDE) {
    throw new BadRequestException(
      `The signature image is ${width}x${height} px; neither side may exceed ${SIGNATURE_MAX_SIDE} px`,
    );
  }
  try {
    await assertDrawable(buffer);
  } catch {
    throw new BadRequestException('The signature image cannot be read; upload another PNG or JPEG');
  }
  return { buffer, mimeType: kind.mimeType, extension: png ? 'png' : 'jpg', width, height };
}
