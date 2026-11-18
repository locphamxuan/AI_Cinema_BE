import { BadRequestException, NotImplementedException } from '@nestjs/common';
import type { AppConfig } from 'src/config/app-config';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { DirectUploadService, UPLOAD_TTL_SECONDS } from './direct-upload.service';
import type { MediaIngestService } from './media-ingest.service';

const MP4_HEAD = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const STUDIO = { id: 'studio-user', role: 'STUDIO' } as never;
const DISCLOSURE = { aiGeneratedParts: ['video'], noRealPersonLikeness: true, noCopyrightedMaterial: true } as never;

describe('DirectUploadService', () => {
  const ingest = { assertCanSubmit: jest.fn(), registerUpload: jest.fn() };
  const storage = { presignPut: jest.fn(), stat: jest.fn(), readHead: jest.fn(), move: jest.fn(), remove: jest.fn() };
  const config = { media: { maxUploadBytes: 1000 }, jwt: { secret: 'test-secret' } } as unknown as AppConfig;
  const service = new DirectUploadService(
    ingest as unknown as MediaIngestService,
    storage as unknown as ObjectStorage,
    config,
  );
  const started = () => service.start('ep-1', { fileName: 'Tap 1.MP4', sizeBytes: 800 }, STUDIO);
  const complete = (uploadToken: string, episodeId = 'ep-1', user = STUDIO) =>
    service.complete(
      episodeId,
      { uploadToken, proposedLabelType: 'AI_GENERATED', aiDisclosure: DISCLOSURE } as never,
      user,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    storage.presignPut.mockResolvedValue('https://r2.example/signed');
    storage.stat.mockResolvedValue({ size: 800 });
    storage.readHead.mockResolvedValue(MP4_HEAD);
    ingest.registerUpload.mockResolvedValue({ id: 'asset' });
  });

  it('signs a PUT into the staging prefix once the studio may deliver the episode', async () => {
    const res = await started();

    expect(ingest.assertCanSubmit).toHaveBeenCalledWith('ep-1', STUDIO);
    expect(storage.presignPut).toHaveBeenCalledWith(
      `uploads/${res.uploadId}/source.mp4`,
      'video/mp4',
      'private',
      UPLOAD_TTL_SECONDS,
    );
    expect(res).toMatchObject({ uploadUrl: 'https://r2.example/signed', headers: { 'Content-Type': 'video/mp4' } });
    expect(res.uploadToken).toContain('.');
  });

  it('refuses another kind of file, a film over the limit, and a storage that cannot sign', async () => {
    await expect(service.start('ep-1', { fileName: 'tap.avi', sizeBytes: 10 }, STUDIO)).rejects.toThrow(/MP4 or MOV/);
    await expect(service.start('ep-1', { fileName: 'tap.mov', sizeBytes: 5000 }, STUDIO)).rejects.toThrow(/larger/);
    storage.presignPut.mockResolvedValueOnce(null);
    await expect(started()).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('turns the checked upload into a version under media/, as the multipart route would', async () => {
    const { uploadId, uploadToken } = await started();

    await expect(complete(uploadToken)).resolves.toEqual({ id: 'asset' });

    expect(storage.readHead).toHaveBeenCalledWith(`uploads/${uploadId}/source.mp4`, 'private', 16);
    expect(storage.move).toHaveBeenCalledWith(
      `uploads/${uploadId}/source.mp4`,
      `media/${uploadId}/source.mp4`,
      'private',
    );
    expect(ingest.registerUpload).toHaveBeenCalledWith(
      'ep-1',
      STUDIO,
      { id: uploadId, storageKey: `media/${uploadId}/source.mp4`, sizeBytes: 800 },
      expect.objectContaining({ proposedLabelType: 'AI_GENERATED' }),
      DISCLOSURE,
    );
  });

  it('throws the upload away when it is not the film announced', async () => {
    const { uploadToken } = await started();
    storage.stat.mockResolvedValueOnce({ size: 799 });
    await expect(complete(uploadToken)).rejects.toThrow(/size announced/);
    storage.readHead.mockResolvedValueOnce(Buffer.from('not a video at all'));
    await expect(complete(uploadToken)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.remove).toHaveBeenCalledTimes(2);
    expect(ingest.registerUpload).not.toHaveBeenCalled();
  });

  it('refuses an upload that never arrived, a forged or foreign token, and an expired one', async () => {
    const { uploadToken } = await started();
    storage.stat.mockResolvedValueOnce(null);
    await expect(complete(uploadToken)).rejects.toThrow(/not been uploaded/);
    await expect(complete(`${uploadToken.split('.')[0]}.forged`)).rejects.toThrow(/not valid/);
    await expect(complete('garbage')).rejects.toThrow(/not valid/);
    await expect(complete(uploadToken, 'ep-2')).rejects.toThrow(/not valid/);
    await expect(complete(uploadToken, 'ep-1', { id: 'other', role: 'STUDIO' } as never)).rejects.toThrow(/not valid/);
    jest.useFakeTimers({ now: Date.now() + (UPLOAD_TTL_SECONDS + 1) * 1000 });
    await expect(complete(uploadToken)).rejects.toThrow(/expired/);
  });
});
