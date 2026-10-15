import { BadRequestException } from '@nestjs/common';
import { PlaybackAccessType, StreamingSessionStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { PlaybackAccessService } from '../playback-access/playback-access.service';
import type { WatchProgressService } from '../watch-progress/watch-progress.service';
import type { AdBreakService } from '../ad-break/ad-break.service';
import type { PlaybackUrlService } from './playback-url.service';
import { StreamingSessionService } from './streaming-session.service';

describe('StreamingSessionService.create', () => {
  const prisma = {
    streamingSession: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    mediaAsset: { findUnique: jest.fn() },
    episode: { findUnique: jest.fn(), findFirst: jest.fn() },
  };
  const access = { verify: jest.fn() };
  const devices = { check: jest.fn() };
  const settings = {
    get: jest.fn().mockResolvedValue({ playbackHeartbeatTimeoutSeconds: 90, episodeCompletionPercent: 90 }),
  };
  const urls = { masterUrl: jest.fn().mockReturnValue('https://api.example/api/playback/s/sess-1/master.m3u8?s=x') };
  const progress = { progress: jest.fn(), save: jest.fn() };
  const ads = { scheduleFor: jest.fn(), scheduleOf: jest.fn() };
  const service = new StreamingSessionService(
    prisma as unknown as PrismaService,
    access as unknown as PlaybackAccessService,
    devices,
    settings as unknown as PlatformSettingService,
    urls as unknown as PlaybackUrlService,
    progress as unknown as WatchProgressService,
    ads as unknown as AdBreakService,
  );

  const verified = {
    episodeId: 'ep-1',
    movieId: 'm-1',
    mediaAssetId: 'asset-1',
    isSelfHosted: true,
    streamUrl: 'https://cdn.example/hls/asset-1/master.m3u8',
    qualities: ['360p'],
    durationSeconds: 600,
    accessType: PlaybackAccessType.PLAN,
    planCode: 'MONTHLY',
    subtitles: [],
    aiLabel: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    access.verify.mockResolvedValue(verified);
    devices.check.mockResolvedValue(undefined);
    progress.progress.mockResolvedValue({ found: false, positionSeconds: 0, completed: false });
    ads.scheduleFor.mockResolvedValue([]);
    ads.scheduleOf.mockResolvedValue([]);
    prisma.streamingSession.findFirst.mockResolvedValue(null);
    prisma.streamingSession.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'sess-1',
      status: StreamingSessionStatus.ACTIVE,
      startPositionSeconds: 0,
      ...data,
    }));
  });

  it('opens a member session after access and device checks (step 11)', async () => {
    const view = await service.create({ episodeId: 'ep-1', userId: 'u-1' });

    expect(access.verify).toHaveBeenCalledWith('ep-1', 'u-1');
    expect(devices.check).toHaveBeenCalledWith('u-1');
    expect(prisma.streamingSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u-1', episodeId: 'ep-1', mediaAssetId: 'asset-1' }),
      }),
    );
    expect(view).toMatchObject({ sessionId: 'sess-1', accessType: 'PLAN', startPositionSeconds: 0 });
    expect(view.stream.masterUrl).toContain('/api/playback/s/sess-1/master.m3u8');
    expect(view.reused).toBeUndefined();
  });

  it('opens a guest session from X-Guest-Key without a device check', async () => {
    const guestKey = '123e4567-e89b-4123-a456-426614174000';
    const view = await service.create({ episodeId: 'ep-1', guestKey });

    expect(access.verify).toHaveBeenCalledWith('ep-1', undefined);
    expect(devices.check).not.toHaveBeenCalled();
    expect(view).toMatchObject({ sessionId: 'sess-1' });
  });

  it('reuses the live session on a double tap instead of opening a second row', async () => {
    prisma.streamingSession.findFirst.mockResolvedValue({
      id: 'sess-live',
      status: StreamingSessionStatus.ACTIVE,
      startPositionSeconds: 0,
    });

    const view = await service.create({ episodeId: 'ep-1', userId: 'u-1' });

    expect(prisma.streamingSession.create).not.toHaveBeenCalled();
    expect(view).toMatchObject({ sessionId: 'sess-live', reused: true });
  });

  it('requires exactly one owner', async () => {
    await expect(service.create({ episodeId: 'ep-1' })).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ episodeId: 'ep-1', userId: 'u-1', guestKey: '123e4567-e89b-4123-a456-426614174000' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a malformed guest key', async () => {
    await expect(service.create({ episodeId: 'ep-1', guestKey: 'not-a-uuid' })).rejects.toThrow(BadRequestException);
    expect(access.verify).not.toHaveBeenCalled();
  });

  it('returns the saved position as a resume hint (step 9)', async () => {
    progress.progress.mockResolvedValue({ found: true, positionSeconds: 320, completed: false });
    const view = await service.create({ episodeId: 'ep-1', userId: 'u-1' });
    expect(view).toMatchObject({ resumePositionSeconds: 320 });
  });

  describe('heartbeat / stop / complete', () => {
    const live = (overrides = {}) => ({
      id: 'sess-1',
      userId: 'u-1',
      guestKey: null,
      episodeId: 'ep-1',
      mediaAssetId: 'asset-1',
      status: StreamingSessionStatus.ACTIVE,
      lastPositionSeconds: 300,
      totalWatchedSeconds: 600,
      ...overrides,
    });

    beforeEach(() => {
      prisma.streamingSession.findUnique.mockResolvedValue(live());
      prisma.mediaAsset.findUnique.mockResolvedValue({ durationSeconds: 1200 });
      prisma.streamingSession.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        ...live(),
        ...data,
      }));
    });

    it('heartbeat persists position and watch time (step 15)', async () => {
      const state = await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 320, watchedSeconds: 12 });
      expect(state).toMatchObject({ sessionId: 'sess-1', positionSeconds: 320, completed: false });
      expect(prisma.streamingSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastPositionSeconds: 320, totalWatchedSeconds: { increment: 12 } }),
        }),
      );
      expect(progress.save).toHaveBeenCalledWith(
        'u-1',
        'ep-1',
        expect.objectContaining({ positionSeconds: 320, completed: false }),
      );
    });

    it('heartbeat past the threshold completes and ends the session (steps 18/20)', async () => {
      const state = await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 1100 });
      expect(state).toMatchObject({ completed: true, status: 'ENDED' });
      expect(prisma.streamingSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ endReason: 'COMPLETED' }) }),
      );
    });

    it('stop saves the position and frees the slot without progress for guests (steps 19/21)', async () => {
      prisma.streamingSession.findUnique.mockResolvedValue(live({ userId: null, guestKey: 'g-1' }));
      const state = await service.stop('sess-1', { guestKey: 'g-1' }, { positionSeconds: 400 });
      expect(state).toMatchObject({ positionSeconds: 400, status: 'ENDED' });
      expect(progress.save).not.toHaveBeenCalled();
    });

    it('complete forces completion even below the threshold', async () => {
      const state = await service.complete('sess-1', { userId: 'u-1' }, {});
      expect(state).toMatchObject({ completed: true, status: 'ENDED' });
      expect(progress.save).toHaveBeenCalledWith('u-1', 'ep-1', expect.objectContaining({ completed: true }));
    });

    it('refuses a caller who does not own the session', async () => {
      await expect(service.heartbeat('sess-1', { userId: 'u-2' }, { positionSeconds: 1 })).rejects.toMatchObject({
        response: expect.objectContaining({ details: expect.objectContaining({ reason: 'SESSION_NOT_OWNER' }) }),
      });
      await expect(service.heartbeat('sess-1', {}, { positionSeconds: 1 })).rejects.toMatchObject({
        response: expect.objectContaining({ details: expect.objectContaining({ reason: 'SESSION_NOT_OWNER' }) }),
      });
    });

    it('refuses a session that already ended', async () => {
      prisma.streamingSession.findUnique.mockResolvedValue(live({ status: StreamingSessionStatus.ENDED }));
      await expect(service.stop('sess-1', { userId: 'u-1' }, { positionSeconds: 1 })).rejects.toMatchObject({
        response: expect.objectContaining({ details: expect.objectContaining({ reason: 'SESSION_NOT_ACTIVE' }) }),
      });
    });
  });

  describe('nextEpisode', () => {
    it('returns the next released episode of the movie (steps 22–24)', async () => {
      prisma.episode.findUnique.mockResolvedValue({ movieId: 'm-1', episodeNumber: 1 });
      prisma.episode.findFirst.mockResolvedValue({ id: 'ep-2', movieId: 'm-1', episodeNumber: 2, title: 'Tập 2' });
      await expect(service.nextEpisode('ep-1')).resolves.toMatchObject({ episodeId: 'ep-2', episodeNumber: 2 });
      expect(prisma.episode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ movieId: 'm-1', episodeNumber: { gt: 1 } }),
          orderBy: { episodeNumber: 'asc' },
        }),
      );
    });

    it('answers null at the end of the movie and 404 for a missing episode', async () => {
      prisma.episode.findUnique.mockResolvedValueOnce({ movieId: 'm-1', episodeNumber: 3 });
      prisma.episode.findFirst.mockResolvedValue(null);
      await expect(service.nextEpisode('ep-3')).resolves.toMatchObject({ episodeId: null });

      prisma.episode.findUnique.mockResolvedValueOnce(null);
      await expect(service.nextEpisode('missing')).rejects.toMatchObject({
        response: expect.objectContaining({ details: expect.objectContaining({ reason: 'EPISODE_NOT_FOUND' }) }),
      });
    });
  });
});
