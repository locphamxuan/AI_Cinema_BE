import { ConflictException } from '@nestjs/common';
import { AssetType, GenerationJobStatus, ProductionPlanStatus, SceneStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { EpisodePackageService } from './episode-package.service';
import { EpisodeSubtitleService } from './episode-subtitle.service';
import { MockVideoTranscoder, STREAM_QUALITIES } from './video-transcoder';

const scene = (id: string, targetDurationSeconds: number) => ({
  id,
  title: `Cảnh ${id}`,
  description: null,
  scriptText: null,
  targetDurationSeconds,
  status: SceneStatus.COMPLETED,
});

const videoJob = (
  id: string,
  sceneId: string,
  storageKey: string,
  durationSeconds: number | null,
  parentJobId: string | null = null,
) => ({
  id,
  parentJobId,
  sceneId,
  status: GenerationJobStatus.COMPLETED,
  generatedAssets: [{ assetType: AssetType.VIDEO, storageKey, durationSeconds, status: 'GENERATED' }],
});

describe('EpisodePackageService.assemble', () => {
  const tx = {
    episodePackage: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    generatedAsset: { findMany: jest.fn() },
    episodePackageAsset: { createMany: jest.fn() },
  };
  const prisma = {
    productionPlan: { findUnique: jest.fn() },
    generationJob: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const subtitles = { buildTracks: jest.fn() };
  const service = new EpisodePackageService(
    prisma as unknown as PrismaService,
    subtitles as unknown as EpisodeSubtitleService,
    new MockVideoTranscoder(),
  );

  const givenPlan = (overrides: object = {}) =>
    prisma.productionPlan.findUnique.mockResolvedValue({
      id: 'plan-id',
      status: ProductionPlanStatus.APPROVED,
      targetLanguages: ['vi', 'en'],
      scenes: [scene('s1', 10), scene('s2', 6)],
      productionProject: { subtitleLanguages: ['vi'], status: 'ACTIVE' },
      ...overrides,
    });

  const buildTracksCall = () =>
    subtitles.buildTracks.mock.calls[0] as [string, { durationSeconds: number }[], string[]];

  beforeEach(() => {
    jest.clearAllMocks();
    givenPlan();
    prisma.generationJob.findMany.mockResolvedValue([
      videoJob('v1', 's1', 'old.m3u8', 7),
      videoJob('v1-retry', 's1', 's1.m3u8', 8.4, 'v1'),
      videoJob('v2', 's2', 's2.m3u8', null),
    ]);
    subtitles.buildTracks.mockResolvedValue([{ language: 'vi', content: 'WEBVTT' }]);
    tx.episodePackage.findFirst.mockResolvedValue({ packageVersion: 2 });
    tx.episodePackage.create.mockResolvedValue({ id: 'package-id' });
    tx.generatedAsset.findMany.mockResolvedValue([]);
  });

  it('stores the transcoded cut and a subtitle track per plan language', async () => {
    await service.assemble('plan-id', {}, 'creator-id');

    const [, scenes, languages] = buildTracksCall();
    expect(scenes.map((s) => s.durationSeconds)).toEqual([8.4, 6]);
    expect(languages).toEqual(['vi', 'en']);
    expect((tx.episodePackage.create.mock.calls[0] as [{ data: object }])[0].data).toMatchObject({
      packageVersion: 3,
      streamUrl: 's1.m3u8',
      durationSeconds: 14,
      qualities: STREAM_QUALITIES,
      subtitles: { create: [{ language: 'vi', content: 'WEBVTT' }] },
    });
  });

  it('falls back to the subtitle languages of the project when the plan has none', async () => {
    givenPlan({ targetLanguages: [] });
    await service.assemble('plan-id', {}, 'creator-id');

    expect(buildTracksCall()[2]).toEqual(['vi']);
  });

  it('refuses to assemble when a scene has no video', async () => {
    prisma.generationJob.findMany.mockResolvedValue([videoJob('v1', 's1', 's1.m3u8', 8)]);

    await expect(service.assemble('plan-id', {}, 'creator-id')).rejects.toThrow(
      new ConflictException('Scene "Cảnh s2" has no video to assemble'),
    );
    expect(subtitles.buildTracks).not.toHaveBeenCalled();
  });
});
