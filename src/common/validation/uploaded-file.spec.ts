import { BadRequestException } from '@nestjs/common';
import { detectKind, FILE_KINDS } from './uploaded-file';

const IMAGES = [FILE_KINDS.png, FILE_KINDS.jpeg, FILE_KINDS.webp, FILE_KINDS.gif, FILE_KINDS.bmp, FILE_KINDS.avif];

describe('detectKind (images)', () => {
  it('accepts GIF, BMP and AVIF by signature', () => {
    expect(detectKind('a.gif', Buffer.from('GIF89a......'), IMAGES).mimeType).toBe('image/gif');
    expect(detectKind('a.bmp', Buffer.from([0x42, 0x4d, 0, 0, 0, 0]), IMAGES).mimeType).toBe('image/bmp');
    const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif')]);
    expect(detectKind('a.avif', avif, IMAGES).mimeType).toBe('image/avif');
  });

  it('rejects an image whose content does not match its extension', () => {
    expect(() => detectKind('a.gif', Buffer.from('not a gif'), IMAGES)).toThrow(BadRequestException);
  });
});
