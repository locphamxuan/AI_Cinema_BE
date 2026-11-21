import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { MediaIngestStatus, MediaSourceMethod } from '@prisma/client';
import { inParallel, MediaPipelineService } from './media-pipeline.service';
import { readableReason } from './media-outcome.service';

describe('inParallel', () => {
  it('keeps at most `limit` running and finishes every item', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await inParallel([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push(n);
      running--;
    });
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('does nothing for no items and rejects with a failure', async () => {
    await expect(inParallel([], 4, () => Promise.reject(new Error('never')))).resolves.toBeUndefined();
    await expect(inParallel([1], 4, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});

describe('MediaPipelineService upload of an encoded delivery', () => {
  it('sends segments first, rendition playlists next and the master playlist last', async () => {
    const asset = {
      id: 'a1',
      ingestStatus: MediaIngestStatus.PENDING,
      sourceMethod: MediaSourceMethod.UPLOAD,
      storageKey: 'media/a1/source.mp4',
    };
    const prisma = {
      mediaAsset: { findUnique: jest.fn().mockResolvedValue(asset), update: jest.fn().mockResolvedValue({}) },
      mediaIngestJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'j1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const order: string[] = [];
    const storage = {
      stream: jest.fn().mockResolvedValue(Readable.from([Buffer.from('video')])),
      putFile: jest.fn((key: string) => Promise.resolve(void order.push(key))),
      publicUrl: (key: string) => `https://cdn.test/${key}`,
    };
    const processor = {
      probe: jest.fn().mockResolvedValue({ durationSeconds: 8, height: 360, hasAudio: false }),
      transcode: jest.fn(async (_in: string, out: string) => {
        await mkdir(path.join(out, '360p'), { recursive: true });
        await writeFile(path.join(out, 'master.m3u8'), '#EXTM3U');
        await writeFile(path.join(out, '360p', 'index.m3u8'), '#EXTM3U');
        await writeFile(path.join(out, '360p', 'seg_000.ts'), 'ts');
        await writeFile(path.join(out, '360p', 'seg_001.ts'), 'ts');
        return { outputDir: out, qualities: ['360p'] };
      }),
    };
    const outcomes = { ready: jest.fn().mockResolvedValue(undefined), fail: jest.fn() };
    const service = new MediaPipelineService(
      prisma as never,
      {} as never,
      storage as never,
      processor,
      outcomes as never,
      { media: { allowPrivateUrls: false, concurrency: 1 } } as never,
    );

    await service.process('a1');

    expect(order.slice(0, 2).sort()).toEqual(['hls/a1/360p/seg_000.ts', 'hls/a1/360p/seg_001.ts']);
    expect(order.slice(2)).toEqual(['hls/a1/360p/index.m3u8', 'hls/a1/master.m3u8']);
    expect(outcomes.ready).toHaveBeenCalledWith(
      asset,
      expect.objectContaining({ streamUrl: 'https://cdn.test/hls/a1/master.m3u8' }),
    );
  });
});

describe('readableReason', () => {
  it('quotes a Vietnamese reason and points to the version history for an English one', () => {
    expect(readableReason('Studio đã gỡ file')).toBe('Studio đã gỡ file. ');
    expect(readableReason('The file holds no video stream')).toBe('Xem lý do trong lịch sử bản phim của tập. ');
  });
});
