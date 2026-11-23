import { readSignatureImage, SIGNATURE_MAX_BYTES } from './signature-image';
import { pngImage } from './template/template.fixtures';

const upload = (buffer: Buffer, originalname = 'chu-ky.png') =>
  ({ buffer, originalname, size: buffer.length }) as Express.Multer.File;

/** The smallest JPEG header that names its size: SOI, an APP0 segment, then a baseline SOF0. */
function jpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof0 = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0, Buffer.alloc(8)]);
}

describe('readSignatureImage', () => {
  it('accepts a PNG signature and reads its size', async () => {
    await expect(readSignatureImage(upload(pngImage(600, 200)))).resolves.toMatchObject({
      mimeType: 'image/png',
      extension: 'png',
      width: 600,
      height: 200,
    });
  });

  it('refuses a missing file, another type, or content that does not match the name', async () => {
    await expect(readSignatureImage(undefined)).rejects.toThrow(/Attach the signature image/);
    await expect(readSignatureImage(upload(Buffer.from('%PDF-1.7'), 'hop-dong.pdf'))).rejects.toThrow(/\.png/);
    await expect(readSignatureImage(upload(pngImage(), 'chu-ky.jpg'))).rejects.toThrow(/must match/);
  });

  it('refuses an image too small to read, or a whole-page scan', async () => {
    await expect(readSignatureImage(upload(pngImage(100, 40)))).rejects.toThrow(/at least 150x50/);
    await expect(readSignatureImage(upload(pngImage(4001, 60)))).rejects.toThrow(/exceed 4000/);
  });

  it('refuses a file over the size limit', async () => {
    const huge = Buffer.concat([pngImage(), Buffer.alloc(SIGNATURE_MAX_BYTES)]);
    await expect(readSignatureImage(upload(huge))).rejects.toThrow(/at most/);
  });

  it('reads a JPEG size from its frame header', async () => {
    await expect(readSignatureImage(upload(jpegHeader(80, 30), 'a.jpg'))).rejects.toThrow(/80x30/);
    await expect(readSignatureImage(upload(jpegHeader(400, 120), 'a.jpeg'))).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: 400,
      height: 120,
    });
  });

  it('refuses an image whose header is fine but whose pixels cannot be decoded', async () => {
    const png = pngImage();
    const broken = Buffer.concat([png.subarray(0, 33), Buffer.from([0, 0, 0, 4, 0x49, 0x44, 0x41, 0x54, 1, 2, 3, 4])]);
    await expect(readSignatureImage(upload(broken))).rejects.toThrow(/cannot be read/);
    const noSize = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.alloc(20)]);
    await expect(readSignatureImage(upload(noSize, 'a.jpg'))).rejects.toThrow(/cannot be read/);
  });
});
