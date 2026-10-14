import { BadRequestException } from '@nestjs/common';
import { PlaybackAccessType, StreamingSessionStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { PlaybackAccessService } from '../playback-access/playback-access.service';
import { StreamingSessionService } from './streaming-session.service';

describe('StreamingSessionService.create', () => {
  const prisma = { streamingSession: { findFirst: jest.fn(), create: jest.fn() } };
  const access = { verify: jest.fn() };
  const devices = { check: jest.fn() };
  const settings = { get: jest.fn().mockResolvedValue({ playbackHeartbeatTimeoutSeconds: 90 }) };
  const service = new StreamingSessionService(
    prisma as unknown as PrismaService,
    access as unknown as PlaybackAccessService,
    devices,
    settings as unknown as PlatformSettingService,
  );

  const verified = {
    episodeId: 'ep-1',
    movieId: 'm-1',
    mediaAssetId: 'asset-1',
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
});
