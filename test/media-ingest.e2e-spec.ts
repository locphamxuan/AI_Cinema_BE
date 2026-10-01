import { readdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { HlsLinkCheckJob } from 'src/modules/media-ingest/hls-link-check.job';
import { type Actor, bootApp, signIn } from './support/api';
import { episodesOf, projectInProduction, type ProjectDetail } from './support/projects';

interface MediaAsset {
  id: string;
  version: number;
  sourceMethod: string;
  ingestStatus: string;
  failureReason: string | null;
  streamUrl: string | null;
  storageKey: string | null;
  isSelfHosted: boolean;
  qualities: string[];
  durationSeconds: number | null;
  ingestJobs: { jobType: string; status: string; attempts: number }[];
}

const MASTER =
  '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\nhigh.m3u8\n';
const VOD = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\na.ts\n#EXTINF:6.0,\nb.ts\n#EXT-X-ENDLIST\n';
// The first bytes of an MP4: the pipeline is mocked, only the signature is checked.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]);

const disclosure = {
  aiTools: ['Kling', 'ElevenLabs'],
  aiGeneratedParts: ['video', 'voice'],
  humanEdited: true,
  noRealPersonLikeness: true,
  noCopyrightedMaterial: true,
};

describe('Media ingest (e2e)', () => {
  let app: INestApplication<App>;
  let studioCdn: Server;
  let cdn: string;
  const files = new Map<string, string | Buffer>();
  let reviewer: Actor;
  let creator: Actor;
  let otherCreator: Actor;
  let project: ProjectDetail;

  beforeAll(async () => {
    files.set('/ep/master.m3u8', MASTER).set('/ep/low.m3u8', VOD).set('/ep/high.m3u8', VOD);
    files.set('/live/master.m3u8', VOD.replace('#EXT-X-ENDLIST\n', '')).set('/files/ep.mp4', MP4);
    files.set('/files/page', '<html>not a video</html>');
    studioCdn = createServer((req, res) => {
      const body = files.get(req.url ?? '');
      if (body === undefined) return void res.writeHead(404).end();
      res.writeHead(200).end(body);
    });
    await new Promise<void>((resolve) => studioCdn.listen(0, '127.0.0.1', resolve));
    cdn = `http://127.0.0.1:${(studioCdn.address() as AddressInfo).port}`;

    app = await bootApp();
    [reviewer, creator, otherCreator] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'creator02@aicinema.com'),
    ]);
    project = await projectInProduction(reviewer, creator, 3);
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => studioCdn.close(resolve));
  });

  const episode = (i: number) => episodesOf(project)[i];
  const statusOf = async (i: number) => {
    const detail = await reviewer.get<ProjectDetail>(`/projects/${project.id}`);
    return episodesOf(detail).find((e) => e.id === episode(i).id)?.status;
  };
  const hlsLink = (path = '/ep/master.m3u8') => ({
    sourceMethod: 'HLS_URL',
    sourceUrl: `${cdn}${path}`,
    proposedLabelType: 'AI_GENERATED',
    aiDisclosure: disclosure,
  });

  it('takes deliveries only from the assigned Creator, with the full AI Disclosure (BR-41)', async () => {
    const path = `/episodes/${episode(0).id}/media`;
    await otherCreator.post(path, hlsLink(), 404);
    await reviewer.post(path, hlsLink(), 403);
    await creator.post(path, { ...hlsLink(), aiDisclosure: { ...disclosure, noCopyrightedMaterial: false } }, 400);
    await creator.post(path, { ...hlsLink(), aiDisclosure: { ...disclosure, aiTools: [] } }, 400);
    await creator.post(path, { ...hlsLink(), sourceUrl: 'file:///etc/passwd' }, 400);
  });

  it('validates an external HLS link and sends the episode to review (BR-17)', async () => {
    const asset = await creator.post<MediaAsset>(`/episodes/${episode(0).id}/media`, hlsLink());

    expect(asset).toMatchObject({
      version: 1,
      ingestStatus: 'READY',
      isSelfHosted: false,
      streamUrl: `${cdn}/ep/master.m3u8`,
      qualities: ['360p', '1080p'],
      durationSeconds: 12,
    });
    expect(asset.ingestJobs).toMatchObject([{ jobType: 'VALIDATE', status: 'COMPLETED', attempts: 1 }]);
    expect(await statusOf(0)).toBe('IN_REVIEW');

    const bell = await reviewer.get<{ data: { type: string; payload: { mediaAssetId: string } }[] }>(
      '/notifications?limit=100',
    );
    expect(bell.data.some((n) => n.type === 'MEDIA_READY' && n.payload.mediaAssetId === asset.id)).toBe(true);
  });

  it('keeps every version: a new upload supersedes the one under review (BR-14)', async () => {
    const asset = await creator.upload<MediaAsset>(
      `/episodes/${episode(0).id}/media/upload`,
      { field: 'file', name: 'tap-1-v2.mp4', content: MP4 },
      { aiDisclosure: JSON.stringify(disclosure), proposedLabelType: 'AI_EDITED' },
    );
    expect(asset).toMatchObject({ version: 2, sourceMethod: 'UPLOAD', ingestStatus: 'READY', isSelfHosted: true });
    expect(asset.qualities).toEqual(['360p', '720p', '1080p']);

    // The rendition is served from public storage.
    const master = await request(app.getHttpServer()).get(new URL(asset.streamUrl!).pathname);
    expect(master.status).toBe(200);
    expect(master.text).toContain('#EXT-X-STREAM-INF');

    const versions = await reviewer.get<MediaAsset[]>(`/episodes/${episode(0).id}/media`);
    expect(versions.map((v) => [v.version, v.ingestStatus])).toEqual([
      [2, 'READY'],
      [1, 'SUPERSEDED'],
    ]);
  });

  it('refuses a file whose content is not a video and leaves the episode as it was', async () => {
    const uploadDir = join(tmpdir(), 'ai-cinema-uploads');
    const tempFiles = async () => (await readdir(uploadDir).catch(() => [])).length;
    const before = await tempFiles();
    await creator.upload(
      `/episodes/${episode(0).id}/media/upload`,
      { field: 'file', name: 'tap-1.mp4', content: Buffer.from('not a video at all') },
      { aiDisclosure: JSON.stringify(disclosure), proposedLabelType: 'AI_EDITED' },
      400,
    );
    await creator.upload(
      `/episodes/${episode(0).id}/media/upload`,
      { field: 'file', name: 'tap-1.mp4', content: MP4 },
      { aiDisclosure: '{"aiTools":', proposedLabelType: 'AI_EDITED' },
      400,
    );
    expect(await statusOf(0)).toBe('IN_REVIEW');
    // Rejected uploads leave no temporary file behind.
    expect(await tempFiles()).toBe(before);
  });

  it('fails a live playlist, tells the Creator, and processes it again once fixed (BR-16)', async () => {
    const failed = await creator.post<MediaAsset>(`/episodes/${episode(1).id}/media`, hlsLink('/live/master.m3u8'));
    expect(failed.ingestStatus).toBe('FAILED');
    expect(failed.failureReason).toContain('live or unfinished');
    expect(await statusOf(1)).toBe('AWAITING_MEDIA');

    const bell = await creator.get<{ data: { type: string; payload: { mediaAssetId: string } }[] }>(
      '/notifications?limit=100',
    );
    expect(bell.data.some((n) => n.type === 'MEDIA_FAILED' && n.payload.mediaAssetId === failed.id)).toBe(true);

    await otherCreator.post(`/media-assets/${failed.id}/retry`, {}, 404);
    files.set('/live/master.m3u8', VOD);
    const retried = await creator.post<MediaAsset>(`/media-assets/${failed.id}/retry`);
    expect(retried).toMatchObject({ ingestStatus: 'READY', durationSeconds: 12 });
    expect(retried.ingestJobs[0]).toMatchObject({ jobType: 'VALIDATE', status: 'COMPLETED', attempts: 2 });
    await creator.post(`/media-assets/${failed.id}/retry`, {}, 409);
  });

  it('downloads an import URL into storage before transcoding it', async () => {
    const rejected = await creator.post<MediaAsset>(`/episodes/${episode(2).id}/media`, {
      ...hlsLink('/files/page'),
      sourceMethod: 'REMOTE_FILE',
    });
    expect(rejected).toMatchObject({ ingestStatus: 'FAILED', failureReason: expect.stringContaining('MP4 or MOV') });

    const asset = await creator.post<MediaAsset>(`/episodes/${episode(2).id}/media`, {
      ...hlsLink('/files/ep.mp4'),
      sourceMethod: 'REMOTE_FILE',
    });
    expect(asset).toMatchObject({ version: 2, ingestStatus: 'READY', isSelfHosted: true, durationSeconds: 60 });
    expect(asset.storageKey).toMatch(/^media\/.+\/source\.mp4$/);
    expect(asset.ingestJobs.map((job) => job.jobType)).toEqual(['DOWNLOAD', 'TRANSCODE']);
  });

  it('reports a dead HLS link of an approved episode once (BR-17)', async () => {
    // Links left by earlier runs of the suite point at closed ports, so only this asset is looked at.
    const prisma = app.get(PrismaService);
    const [hls] = await reviewer.get<MediaAsset[]>(`/episodes/${episode(1).id}/media`);
    await prisma.episode.update({
      where: { id: episode(1).id },
      data: { approvedMediaAssetId: hls.id, status: 'APPROVED' },
    });
    const deadReports = async () => {
      const bell = await creator.get<{ data: { type: string; payload: { mediaAssetId: string } }[] }>(
        '/notifications?limit=100',
      );
      return bell.data.filter((n) => n.type === 'HLS_LINK_DEAD' && n.payload.mediaAssetId === hls.id).length;
    };
    const job = app.get(HlsLinkCheckJob);

    const before = new Date();
    await job.sweep();
    const checked = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: hls.id } });
    expect(checked.lastCheckedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(await deadReports()).toBe(0);

    files.delete('/live/master.m3u8');
    await job.sweep();
    await job.sweep();
    expect(await deadReports()).toBe(1);
  });
});
