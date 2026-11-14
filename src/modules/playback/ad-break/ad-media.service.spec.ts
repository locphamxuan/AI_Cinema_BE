import { BadRequestException } from '@nestjs/common';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AdMediaService } from './ad-media.service';

const mp4 = (name = 'ad.mp4') =>
  ({
    originalname: name,
    size: 16,
    buffer: Buffer.from('\0\0\0\x18ftypisom\0\0\0\0', 'latin1'),
  }) as Express.Multer.File;

describe('AdMediaService', () => {
  const storage = { putBuffer: jest.fn(), publicUrl: (key: string) => `https://cdn.test/${key}` };
  const service = new AdMediaService(storage as unknown as ObjectStorage);

  beforeEach(() => jest.clearAllMocks());

  it('stores an MP4 as a public object under ads/ and answers its URL', async () => {
    const { mediaUrl } = await service.upload(mp4());

    const [key, , contentType, visibility] = storage.putBuffer.mock.calls[0] as [string, Buffer, string, string];
    expect(key).toMatch(/^ads\/[0-9a-f-]{36}\.mp4$/);
    expect([contentType, visibility]).toEqual(['video/mp4', 'public']);
    expect(mediaUrl).toBe(`https://cdn.test/${key}`);
  });

  it('refuses a missing file and anything that is not an MP4', async () => {
    await expect(service.upload(undefined)).rejects.toThrow(BadRequestException);
    await expect(service.upload(mp4('ad.mov'))).rejects.toThrow(BadRequestException);
    const fake = { ...mp4(), buffer: Buffer.from('not a video at all') } as Express.Multer.File;
    await expect(service.upload(fake)).rejects.toThrow(BadRequestException);
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });
});
