import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EpisodeStatus, MediaIngestStatus, PlaybackAccessType } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { PlaybackAccessService } from './playback-access.service';

describe('PlaybackAccessService.verify', () => {
  const prisma = {
    episode: { findFirst: jest.fn() },
    subscription: { findFirst: jest.fn() },
    episodeAccess: { findFirst: jest.fn() },
  };
  const settings = {
    get: jest.fn().mockResolvedValue({ freeStarterEpisodeCount: 2, episodeCoinPriceMin: 1 }),
  };
  const service = new PlaybackAccessService(
    prisma as unknown as PrismaService,
    settings as unknown as PlatformSettingService,
  );

  const media = (overrides: Record<string, unknown> = {}) => ({
    id: 'asset-1',
    streamUrl: 'https://cdn.example/hls/asset-1/master.m3u8',
    ingestStatus: MediaIngestStatus.READY,
    qualities: ['360p', '720p'],
    durationSeconds: 1200,
    subtitles: [],
    aiContentLabel: null,
    ...overrides,
  });

  const episode = (overrides: Record<string, unknown> = {}) => ({
    id: 'ep-1',
    movieId: 'm-1',
    episodeNumber: 5,
    coinPrice: 25,
    revisionStartedAt: null,
    approvedMediaAsset: media(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ freeStarterEpisodeCount: 2, episodeCoinPriceMin: 1 });
    prisma.episode.findFirst.mockResolvedValue(episode());
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.episodeAccess.findFirst.mockResolvedValue(null);
  });

  it('answers 404 when the episode is not published', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);
    await expect(service.verify('missing')).rejects.toThrow(NotFoundException);
    expect(prisma.episode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'missing', status: EpisodeStatus.PUBLISHED } }),
    );
  });

  it('refuses an episode under revision (step 7)', async () => {
    prisma.episode.findFirst.mockResolvedValue(episode({ revisionStartedAt: new Date() }));
    await expect(service.verify('ep-1', 'u-1')).rejects.toMatchObject({
      name: 'ConflictException',
      response: expect.objectContaining({ details: expect.objectContaining({ reason: 'EPISODE_UNDER_REVISION' }) }),
    });
  });

  it('refuses an episode with no playable stream', async () => {
    prisma.episode.findFirst.mockResolvedValue(episode({ approvedMediaAsset: media({ streamUrl: null }) }));
    await expect(service.verify('ep-1', 'u-1')).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ reason: 'MEDIA_NOT_READY' }) }),
    });
  });

  it('opens a Free Starter episode for a guest (steps 1-4)', async () => {
    prisma.episode.findFirst.mockResolvedValue(episode({ episodeNumber: 1 }));
    await expect(service.verify('ep-1')).resolves.toMatchObject({
      episodeId: 'ep-1',
      accessType: PlaybackAccessType.FREE_STARTER,
      planCode: null,
    });
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('sends a guest without free access back to Main Flow 2 (steps 3-4)', async () => {
    await expect(service.verify('ep-1')).rejects.toThrow(ForbiddenException);
    await expect(service.verify('ep-1')).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ reason: 'PLAYBACK_ACCESS_REQUIRED' }) }),
    });
  });

  it('hands a running plan straight to playback (steps 5-7)', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ plan: { code: 'MONTHLY' } });
    await expect(service.verify('ep-1', 'u-1')).resolves.toMatchObject({
      accessType: PlaybackAccessType.PLAN,
      planCode: 'MONTHLY',
    });
  });

  it('honours a bought episode', async () => {
    prisma.episodeAccess.findFirst.mockResolvedValue({ source: 'EPISODE_PURCHASE' });
    await expect(service.verify('ep-1', 'u-1')).resolves.toMatchObject({
      accessType: PlaybackAccessType.EPISODE_PURCHASE,
    });
  });

  it('denies a member with nothing (step 3, back to Main Flow 2)', async () => {
    await expect(service.verify('ep-1', 'u-1')).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ reason: 'PLAYBACK_ACCESS_REQUIRED' }) }),
    });
  });
});
