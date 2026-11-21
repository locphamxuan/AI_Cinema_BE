import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from 'src/config/app-config';
import { S3ObjectStorage } from './s3-storage';

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

const config = {
  publicBaseUrl: 'https://cdn.example',
  s3: { endpoint: 'https://r2.example', region: 'auto', bucket: 'films', accessKeyId: 'k', secretAccessKey: 's' },
} as unknown as AppConfig['storage'];

const firstCommand = (spy: jest.SpyInstance): unknown => (spy.mock.calls as unknown[][])[0][0];

describe('S3ObjectStorage — direct uploads', () => {
  let send: jest.SpyInstance;
  let storage: S3ObjectStorage;

  beforeEach(() => {
    send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    storage = new S3ObjectStorage(config);
  });
  afterEach(() => send.mockRestore());

  it('signs a PUT for the object under its visibility prefix, valid for the given seconds', async () => {
    jest.mocked(getSignedUrl).mockResolvedValue('https://r2.example/signed');
    await expect(storage.presignPut('uploads/u1/source.mp4', 'video/mp4', 'private', 900)).resolves.toBe(
      'https://r2.example/signed',
    );
    const [, command, options] = jest.mocked(getSignedUrl).mock.calls[0];
    expect((command as { input: unknown }).input).toEqual({
      Bucket: 'films',
      Key: 'private/uploads/u1/source.mp4',
      ContentType: 'video/mp4',
    });
    expect(options).toEqual({ expiresIn: 900 });
  });

  it('tells the size of a stored object, nothing for a missing one, and passes other errors on', async () => {
    send.mockResolvedValueOnce({ ContentLength: 2048 });
    await expect(storage.stat('uploads/u1/source.mp4', 'private')).resolves.toEqual({ size: 2048 });
    expect(firstCommand(send)).toBeInstanceOf(HeadObjectCommand);

    send.mockResolvedValueOnce({});
    await expect(storage.stat('uploads/u1/source.mp4', 'private')).resolves.toEqual({ size: 0 });

    send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NotFound' }));
    await expect(storage.stat('uploads/u2/source.mp4', 'private')).resolves.toBeNull();

    send.mockRejectedValueOnce(new Error('denied'));
    await expect(storage.stat('uploads/u3/source.mp4', 'private')).rejects.toThrow('denied');
  });

  it('reads only the first bytes of an object, and an empty buffer for an empty body', async () => {
    send.mockResolvedValueOnce({ Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) } });
    await expect(storage.readHead('uploads/u1/source.mp4', 'private', 16)).resolves.toEqual(Buffer.from([1, 2, 3]));
    const command = firstCommand(send) as GetObjectCommand;
    expect(command.input).toEqual({ Bucket: 'films', Key: 'private/uploads/u1/source.mp4', Range: 'bytes=0-15' });

    send.mockResolvedValueOnce({});
    await expect(storage.readHead('uploads/u1/source.mp4', 'private', 16)).resolves.toEqual(Buffer.alloc(0));
  });

  it('moves an object inside the bucket by copying it and deleting the source', async () => {
    await storage.move('uploads/u1/source.mp4', 'media/u1/source.mp4', 'private');
    const [copy, remove] = (send.mock.calls as unknown[][]).map(([c]) => c as CopyObjectCommand | DeleteObjectCommand);
    expect(copy).toBeInstanceOf(CopyObjectCommand);
    expect(copy.input).toEqual({
      Bucket: 'films',
      Key: 'private/media/u1/source.mp4',
      CopySource: 'films/private/uploads/u1/source.mp4',
    });
    expect(remove).toBeInstanceOf(DeleteObjectCommand);
    expect(remove.input).toEqual({ Bucket: 'films', Key: 'private/uploads/u1/source.mp4' });
  });
});
