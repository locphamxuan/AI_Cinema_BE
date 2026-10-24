import { BadRequestException } from '@nestjs/common';
import { AdBreakStatus, StreamingSessionStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { AdBreakService, spreadPositions, weightedOrder } from './ad-break.service';

describe('spreadPositions', () => {
  it('lays cues evenly inside the clean window (step 13)', () => {
    expect(spreadPositions(1320, 2)).toEqual([460, 860]);
    expect(spreadPositions(300, 1)).toEqual([150]);
  });

  it('rejects a non-positive count', () => {
    expect(() => spreadPositions(300, 0)).toThrow(BadRequestException);
  });
});

describe('weightedOrder', () => {
  it('draws every ad exactly once, heavier ones first on average', () => {
    const ads = [{ weight: 1 }, { weight: 100 }, { weight: 1 }];
    const firsts = Array.from({ length: 20 }, () => weightedOrder(ads)[0]?.weight);
    expect(firsts).toContain(100);
    expect(weightedOrder(ads)).toHaveLength(3);
  });
});

describe('AdBreakService', () => {
  const prisma = {
    ad: { findMany: jest.fn() },
    subscription: { findFirst: jest.fn() },
    sessionAdBreak: { createMany: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  };
  const settings = { get: jest.fn().mockResolvedValue({ adMaxBreaksPerEpisode: 2 }) };
  const service = new AdBreakService(prisma as unknown as PrismaService, settings as unknown as PlatformSettingService);

  const ad = (overrides = {}) => ({
    id: 'ad-1',
    title: 'Ad',
    mediaUrl: 'https://cdn.example/a.mp4',
    clickUrl: null,
    durationSeconds: 15,
    weight: 1,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ adMaxBreaksPerEpisode: 2 });
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.ad.findMany.mockResolvedValue([ad({ id: 'ad-1' }), ad({ id: 'ad-2' })]);
    prisma.sessionAdBreak.createMany.mockResolvedValue({ count: 2 });
    prisma.sessionAdBreak.findMany.mockResolvedValue([
      { id: 'br-460', positionSeconds: 460, ad: ad({ id: 'ad-1' }) },
      { id: 'br-860', positionSeconds: 860, ad: ad({ id: 'ad-2' }) },
    ]);
  });

  it('schedules up to the platform cap with one atomic insert (steps 12–13, P4-1)', async () => {
    const schedule = await service.scheduleFor('sess-1', { userId: 'u-1', durationSeconds: 1320 });
    expect(schedule.map((item) => item.positionSeconds)).toEqual([460, 860]);
    expect(prisma.sessionAdBreak.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.sessionAdBreak.createMany).toHaveBeenCalledWith({
      data: [
        { streamingSessionId: 'sess-1', adId: expect.any(String), positionSeconds: 460 },
        { streamingSessionId: 'sess-1', adId: expect.any(String), positionSeconds: 860 },
      ],
      skipDuplicates: true,
    });
  });

  it('schedules nothing for ad-free plans, short episodes or no valid ad', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ plan: { features: { adFree: true } } });
    await expect(service.scheduleFor('sess-1', { userId: 'u-1', durationSeconds: 1320 })).resolves.toEqual([]);
    await expect(service.scheduleFor('sess-1', { durationSeconds: 100 })).resolves.toEqual([]);
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.ad.findMany.mockResolvedValue([]);
    await expect(service.scheduleFor('sess-1', { durationSeconds: 1320 })).resolves.toEqual([]);
    expect(prisma.sessionAdBreak.createMany).not.toHaveBeenCalled();
  });

  it('marks a cue played once, then replays idempotently (step 17)', async () => {
    const row = (status: AdBreakStatus) => ({
      id: 'br-1',
      streamingSessionId: 'sess-1',
      positionSeconds: 460,
      status,
      playedAt: status === AdBreakStatus.PLAYED ? new Date() : null,
      session: { userId: 'u-1', guestKey: null, status: StreamingSessionStatus.ACTIVE },
    });
    prisma.sessionAdBreak.findUnique.mockResolvedValue(row(AdBreakStatus.SCHEDULED));
    prisma.sessionAdBreak.update.mockResolvedValue(row(AdBreakStatus.PLAYED));

    const played = await service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 460 });
    expect(played).toMatchObject({ breakId: 'br-1', status: 'PLAYED' });

    prisma.sessionAdBreak.findUnique.mockResolvedValue(row(AdBreakStatus.PLAYED));
    await expect(
      service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 460 }),
    ).resolves.toMatchObject({ status: 'PLAYED' });
    expect(prisma.sessionAdBreak.update).toHaveBeenCalledTimes(1);
  });

  it('counts an impression only inside the cue window (P4-2)', async () => {
    prisma.sessionAdBreak.findUnique.mockResolvedValue({
      id: 'br-1',
      streamingSessionId: 'sess-1',
      positionSeconds: 460,
      status: AdBreakStatus.SCHEDULED,
      playedAt: null,
      session: { userId: 'u-1', guestKey: null, status: StreamingSessionStatus.ACTIVE },
    });
    prisma.sessionAdBreak.update.mockResolvedValue({
      id: 'br-1',
      status: AdBreakStatus.PLAYED,
      playedAt: new Date(),
    });

    // Opening the movie and claiming every cue: far before the cue, no money.
    await expect(service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 0 })).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          details: expect.objectContaining({ reason: 'AD_BREAK_NOT_REACHED', cuePositionSeconds: 460 }),
        }),
      },
    );
    // Forward seek over the cue: the ad never started, so it is not billed.
    await expect(
      service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 491 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        details: expect.objectContaining({ reason: 'AD_BREAK_MISSED', cuePositionSeconds: 460 }),
      }),
    });
    expect(prisma.sessionAdBreak.update).not.toHaveBeenCalled();

    // The tolerance is inclusive: cue + 30s still counts once.
    await expect(
      service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 490 }),
    ).resolves.toMatchObject({ status: 'PLAYED' });
    expect(prisma.sessionAdBreak.update).toHaveBeenCalledTimes(1);
  });

  it('refuses a cue of another session or another owner', async () => {
    prisma.sessionAdBreak.findUnique.mockResolvedValue(null);
    await expect(
      service.markPlayed('sess-1', 'missing', { userId: 'u-1' }, { positionSeconds: 460 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ reason: 'AD_BREAK_NOT_FOUND' }) }),
    });
    prisma.sessionAdBreak.findUnique.mockResolvedValue({
      id: 'br-1',
      streamingSessionId: 'sess-2',
      positionSeconds: 460,
      session: { userId: 'u-1', status: StreamingSessionStatus.ACTIVE },
    });
    await expect(
      service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 460 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ reason: 'AD_BREAK_NOT_FOUND' }) }),
    });
  });
});
