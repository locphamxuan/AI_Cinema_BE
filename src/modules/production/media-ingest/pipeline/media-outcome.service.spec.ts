import { MediaIngestStatus, type MediaAsset } from '@prisma/client';
import { MediaOutcomeService, type ReadyResult } from './media-outcome.service';

const asset = { id: 'a1', episodeId: 'e1', version: 2, studioHandoffId: null } as MediaAsset;

/** A transaction where the asset is the latest version and its episode already left PROCESSING. */
function outcomeService() {
  const tx = {
    mediaAsset: {
      aggregate: jest.fn().mockResolvedValue({ _max: { version: 2 } }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    mediaSubtitle: {
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    episode: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'e1',
        movieId: 'm1',
        episodeNumber: 1,
        movie: { id: 'm1', title: 'Phim', project: { status: 'IN_PRODUCTION', reviewerId: 'r1' } },
      }),
    },
  };
  const prisma = { $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
  const service = new MediaOutcomeService(
    prisma as never,
    { record: jest.fn() } as never,
    { notify: jest.fn() } as never,
  );
  return { service, tx };
}

const result: ReadyResult = {
  streamUrl: 'https://cdn.test/hls/a1/master.m3u8',
  qualities: ['360p'],
  durationSeconds: 8,
};

describe('MediaOutcomeService.ready subtitles', () => {
  it('replaces the subtitle rows of the asset and keeps them out of the asset update', async () => {
    const { service, tx } = outcomeService();
    const subtitles = [{ language: 'vi', fileUrl: 'https://cdn.test/hls/a1/subtitles/vi.vtt', isDefault: true }];

    await service.ready(asset, { ...result, subtitles });

    expect(tx.mediaAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', ingestStatus: { notIn: expect.any(Array) } },
      data: { ...result, ingestStatus: MediaIngestStatus.READY, failureReason: null },
    });
    expect(tx.mediaSubtitle.deleteMany).toHaveBeenCalledWith({ where: { mediaAssetId: 'a1' } });
    expect(tx.mediaSubtitle.createMany).toHaveBeenCalledWith({ data: [{ mediaAssetId: 'a1', ...subtitles[0] }] });
    expect(tx.mediaSubtitle.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.mediaSubtitle.createMany.mock.invocationCallOrder[0],
    );
  });

  it('leaves the rows alone for an HLS link, which carries no subtitles', async () => {
    const { service, tx } = outcomeService();

    await service.ready(asset, result);

    expect(tx.mediaSubtitle.deleteMany).not.toHaveBeenCalled();
    expect(tx.mediaSubtitle.createMany).not.toHaveBeenCalled();
  });

  it('writes no rows when the delivery already ended another way', async () => {
    const { service, tx } = outcomeService();
    tx.mediaAsset.updateMany.mockResolvedValue({ count: 0 });

    await service.ready(asset, { ...result, subtitles: [] });

    expect(tx.mediaSubtitle.deleteMany).not.toHaveBeenCalled();
  });
});
