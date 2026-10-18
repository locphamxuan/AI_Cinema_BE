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

  it('answers 404 when the episode is not listed', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);
    await expect(service.verify('missing')).rejects.toThrow(NotFoundException);
    expect(prisma.episode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'missing', OR: [{ status: EpisodeStatus.PUBLISHED }, { revisionStartedAt: { not: null } }] },
      }),
    );
  });

  it('refuses an episode under revision with its reason, not a 404 (step 7, BR-56)', async () => {
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

  it('asks for only the media columns the answer is built from (hardening #14)', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ plan: { code: 'MONTHLY' } });

    await service.verify('ep-1', 'u-1');

    // The studio-only media columns (ai_disclosure JSON, storage_key, failure_reason) no longer
    // ride back on a query that runs on every session creation.
    expect(prisma.episode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          approvedMediaAsset: {
            select: {
              id: true,
              isSelfHosted: true,
              streamUrl: true,
              qualities: true,
              durationSeconds: true,
              ingestStatus: true,
              subtitles: { select: { language: true, fileUrl: true, isDefault: true } },
              aiContentLabel: { select: { labelType: true, labelText: true, displayLocation: true } },
            },
          },
        },
      }),
    );
  });
});

describe('PlaybackAccessService.stillEntitled', () => {
  const prisma = {
    subscription: { findFirst: jest.fn() },
    episodeAccess: { findFirst: jest.fn() },
  };
  const settings = { get: jest.fn() };
  const service = new PlaybackAccessService(
    prisma as unknown as PrismaService,
    settings as unknown as PlatformSettingService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.episodeAccess.findFirst.mockResolvedValue(null);
  });

  it('never checks a guest or free session: it holds no entitlement to lose', async () => {
    await expect(
      service.stillEntitled({ userId: null, episodeId: 'ep-1', accessType: PlaybackAccessType.FREE_STARTER }),
    ).resolves.toBe(true);
    await expect(
      service.stillEntitled({ userId: 'u-1', episodeId: 'ep-1', accessType: PlaybackAccessType.FREE_STARTER }),
    ).resolves.toBe(true);
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.episodeAccess.findFirst).not.toHaveBeenCalled();
  });

  it('keeps a plan session alive while the plan runs, with one read', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1' });
    await expect(
      service.stillEntitled({ userId: 'u-1', episodeId: 'ep-1', accessType: PlaybackAccessType.PLAN }),
    ).resolves.toBe(true);
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u-1',
          status: { in: ['ACTIVE', 'PAST_DUE'] },
          currentPeriodEnd: { gt: expect.any(Date) },
        }),
      }),
    );
    // The running plan answers the beat: no second read.
    expect(prisma.episodeAccess.findFirst).not.toHaveBeenCalled();
  });

  it('ends a plan session once the plan lapsed and nothing else covers the episode', async () => {
    await expect(
      service.stillEntitled({ userId: 'u-1', episodeId: 'ep-1', accessType: PlaybackAccessType.PLAN }),
    ).resolves.toBe(false);
    // Before calling access lost, the unlock is checked: verify() would still grant it.
    expect(prisma.episodeAccess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-1', episodeId: 'ep-1', revokedAt: null } }),
    );
  });

  it('keeps a plan session whose lapsed plan is backed by an owned episode', async () => {
    prisma.episodeAccess.findFirst.mockResolvedValue({ id: 'acc-1' });
    await expect(
      service.stillEntitled({ userId: 'u-1', episodeId: 'ep-1', accessType: PlaybackAccessType.PLAN }),
    ).resolves.toBe(true);
  });

  it('keeps a purchased session while the unlock stands, without reading plans', async () => {
    prisma.episodeAccess.findFirst.mockResolvedValue({ id: 'acc-1' });
    await expect(
      service.stillEntitled({ userId: 'u-1', episodeId: 'ep-1', accessType: PlaybackAccessType.EPISODE_PURCHASE }),
    ).resolves.toBe(true);
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('ends a purchased session once the take-down revoked the unlock (REMOVAL + refund)', async () => {
    await expect(
      service.stillEntitled({ userId: 'u-1', episodeId: 'ep-1', accessType: PlaybackAccessType.EPISODE_PURCHASE }),
    ).resolves.toBe(false);
    expect(prisma.episodeAccess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-1', episodeId: 'ep-1', revokedAt: null } }),
    );
  });
});
