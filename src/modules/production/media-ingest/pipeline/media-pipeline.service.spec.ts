import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { MediaIngestStatus, MediaSourceMethod } from '@prisma/client';
import { inParallel, MediaPipelineService } from './media-pipeline.service';
import { readableReason } from './media-outcome.service';
import type { MediaProcessor, ProbedFile } from 'src/infrastructure/media/media-processor';

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

const asset = {
  id: 'a1',
  ingestStatus: MediaIngestStatus.PENDING,
  sourceMethod: MediaSourceMethod.UPLOAD,
  storageKey: 'media/a1/source.mp4',
};

/** A pipeline over mocked Prisma, storage and FFmpeg; `probed` is what ffprobe reports for the delivery. */
function pipelineWith(probed: ProbedFile, extractSubtitle: MediaProcessor['extractSubtitle']) {
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
    stream: jest.fn(() => Promise.resolve(Readable.from([Buffer.from('video')]))),
    putFile: jest.fn((key: string) => Promise.resolve(void order.push(key))),
    publicUrl: (key: string) => `https://cdn.test/${key}`,
  };
  const processor = {
    probe: jest.fn().mockResolvedValue(probed),
    transcode: jest.fn(async (_in: string, out: string) => {
      await mkdir(path.join(out, '360p'), { recursive: true });
      await writeFile(path.join(out, 'master.m3u8'), '#EXTM3U');
      await writeFile(path.join(out, '360p', 'index.m3u8'), '#EXTM3U');
      await writeFile(path.join(out, '360p', 'seg_000.ts'), 'ts');
      await writeFile(path.join(out, '360p', 'seg_001.ts'), 'ts');
      return { outputDir: out, qualities: ['360p'] };
    }),
    extractSubtitle: jest.fn(extractSubtitle),
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
  return { service, order, outcomes, processor };
}

const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nXin chào\n';

describe('MediaPipelineService upload of an encoded delivery', () => {
  it('sends segments first, rendition playlists next and the master playlist last', async () => {
    const { service, order, outcomes, processor } = pipelineWith(
      { durationSeconds: 8, height: 360, hasAudio: false },
      () => Promise.reject(new Error('no subtitles here')),
    );

    await service.process('a1');

    expect(order.slice(0, 2).sort()).toEqual(['hls/a1/360p/seg_000.ts', 'hls/a1/360p/seg_001.ts']);
    expect(order.slice(2)).toEqual(['hls/a1/360p/index.m3u8', 'hls/a1/master.m3u8']);
    expect(processor.extractSubtitle).not.toHaveBeenCalled();
    expect(outcomes.ready).toHaveBeenCalledWith(
      asset,
      expect.objectContaining({ streamUrl: 'https://cdn.test/hls/a1/master.m3u8', subtitles: [] }),
    );
  });

  it('stores each muxed subtitle as public WebVTT and leaves out the ones that fail', async () => {
    const { service, order, outcomes, processor } = pipelineWith(
      {
        durationSeconds: 8,
        height: 360,
        hasAudio: false,
        subtitles: [
          { position: 0, codec: 'mov_text', language: 'eng' },
          { position: 1, codec: 'mov_text', language: 'vie' },
          { position: 2, codec: 'hdmv_pgs_subtitle', language: 'jpn' },
          { position: 3, codec: 'subrip', language: 'kor' },
          { position: 4, codec: 'ass', language: 'chi' },
        ],
      },
      async (_in, position, out) => {
        if (position === 3) throw new Error('ffmpeg exited with 1');
        await writeFile(out, position === 4 ? 'WEBVTT\n\n' : VTT);
      },
    );

    await service.process('a1');

    expect(processor.extractSubtitle.mock.calls.map((call) => call[1])).toEqual([0, 1, 3, 4]);
    expect(order).toEqual(expect.arrayContaining(['hls/a1/subtitles/en.vtt', 'hls/a1/subtitles/vi.vtt']));
    expect(order).not.toContain('hls/a1/subtitles/ko.vtt');
    expect(outcomes.ready).toHaveBeenCalledWith(
      asset,
      expect.objectContaining({
        subtitles: [
          { language: 'en', fileUrl: 'https://cdn.test/hls/a1/subtitles/en.vtt', isDefault: false },
          { language: 'vi', fileUrl: 'https://cdn.test/hls/a1/subtitles/vi.vtt', isDefault: true },
        ],
      }),
    );
  });
});

describe('readableReason', () => {
  it('quotes a Vietnamese reason and points to the version history for an English one', () => {
    expect(readableReason('Studio đã gỡ file')).toBe('Studio đã gỡ file. ');
    expect(readableReason('The file holds no video stream')).toBe('Xem lý do trong lịch sử bản phim của tập. ');
  });
});
