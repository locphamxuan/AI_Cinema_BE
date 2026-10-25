import { AdBreakStatus, StreamingSessionStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { AdBreakService, isAdFreePlan } from './ad-break.service';

describe('isAdFreePlan (P4-5)', () => {
  it('is true only when the running plan features say so', () => {
    expect(isAdFreePlan({ features: { adFree: true } })).toBe(true);
    expect(isAdFreePlan({ features: { adFree: false } })).toBe(false);
    expect(isAdFreePlan({ features: { maxDevices: 2 } })).toBe(false);
    expect(isAdFreePlan({ features: { adFree: 'true' } })).toBe(false);
    expect(isAdFreePlan({ features: null })).toBe(false);
    expect(isAdFreePlan(null)).toBe(false);
  });
});

describe('AdBreakService', () => {
  const prisma = {
    ad: { findMany: jest.fn() },
    episodeAdSlot: { findMany: jest.fn() },
    sessionAdBreak: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
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
    prisma.ad.findMany.mockResolvedValue([ad({ id: 'ad-1' }), ad({ id: 'ad-2' })]);
    prisma.episodeAdSlot.findMany.mockResolvedValue([]);
    prisma.sessionAdBreak.createMany.mockResolvedValue({ count: 2 });
    prisma.sessionAdBreak.findMany.mockResolvedValue([
      { id: 'br-460', positionSeconds: 460, ad: ad({ id: 'ad-1' }) },
      { id: 'br-860', positionSeconds: 860, ad: ad({ id: 'ad-2' }) },
    ]);
  });

  it('lays random cues up to the platform cap with one atomic insert when no cue is placed (P4-1)', async () => {
    const schedule = await service.scheduleFor('sess-1', { episodeId: 'ep-1', adFree: false, durationSeconds: 1320 });
    expect(schedule.map((item) => item.positionSeconds)).toEqual([460, 860]);
    expect(prisma.episodeAdSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { episodeId: 'ep-1' } }),
    );
    expect(prisma.sessionAdBreak.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.sessionAdBreak.createMany).toHaveBeenCalledWith({
      data: [
        { streamingSessionId: 'sess-1', adId: expect.any(String), positionSeconds: expect.any(Number) },
        { streamingSessionId: 'sess-1', adId: expect.any(String), positionSeconds: expect.any(Number) },
      ],
      skipDuplicates: true,
    });
  });

  it('follows the cues the Admin placed on the episode, as many as there are (BR-32)', async () => {
    prisma.episodeAdSlot.findMany.mockResolvedValue([
      { positionSeconds: 120, adId: 'ad-2' },
      { positionSeconds: 600, adId: null },
      { positionSeconds: 1000, adId: null },
    ]);
    await service.scheduleFor('sess-1', { episodeId: 'ep-1', adFree: false, durationSeconds: 1320 });
    expect(prisma.sessionAdBreak.createMany).toHaveBeenCalledWith({
      data: [
        { streamingSessionId: 'sess-1', adId: 'ad-2', positionSeconds: 120 },
        { streamingSessionId: 'sess-1', adId: expect.any(String), positionSeconds: 600 },
        { streamingSessionId: 'sess-1', adId: expect.any(String), positionSeconds: 1000 },
      ],
      skipDuplicates: true,
    });
  });

  it('schedules nothing for ad-free plans, unknown lengths or no valid ad', async () => {
    const input = { episodeId: 'ep-1', adFree: false, durationSeconds: 1320 };
    await expect(service.scheduleFor('sess-1', { ...input, adFree: true })).resolves.toEqual([]);
    await expect(service.scheduleFor('sess-1', { ...input, durationSeconds: null })).resolves.toEqual([]);
    prisma.ad.findMany.mockResolvedValue([]);
    await expect(service.scheduleFor('sess-1', input)).resolves.toEqual([]);
    expect(prisma.sessionAdBreak.createMany).not.toHaveBeenCalled();
  });

  interface BreakRow {
    id: string;
    streamingSessionId: string;
    positionSeconds: number;
    status: AdBreakStatus;
    playedAt: Date | null;
    completedView: boolean;
    ad: { durationSeconds: number };
    session: { userId: string | null; guestKey: string | null; status: StreamingSessionStatus };
  }

  const breakRow = (overrides: Partial<BreakRow> = {}): BreakRow => ({
    id: 'br-1',
    streamingSessionId: 'sess-1',
    positionSeconds: 460,
    status: AdBreakStatus.SCHEDULED,
    playedAt: null,
    completedView: false,
    ad: { durationSeconds: 15 },
    session: { userId: 'u-1', guestKey: null, status: StreamingSessionStatus.ACTIVE },
    ...overrides,
  });

  it('marks a cue played once, then replays idempotently (step 17)', async () => {
    prisma.sessionAdBreak.findUnique.mockResolvedValue(breakRow());
    prisma.sessionAdBreak.update.mockResolvedValue(breakRow({ status: AdBreakStatus.PLAYED, playedAt: new Date() }));

    const played = await service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 460 });
    expect(played).toMatchObject({ breakId: 'br-1', status: 'PLAYED', completedView: false });
    // P4-3: starting an ad is the impression, not a completed view.
    expect(prisma.sessionAdBreak.update).toHaveBeenCalledWith({
      where: { id: 'br-1' },
      data: { status: AdBreakStatus.PLAYED, playedAt: expect.any(Date), completedView: false },
    });

    prisma.sessionAdBreak.findUnique.mockResolvedValue(
      breakRow({ status: AdBreakStatus.PLAYED, playedAt: new Date() }),
    );
    await expect(
      service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 460 }),
    ).resolves.toMatchObject({ status: 'PLAYED', completedView: false });
    expect(prisma.sessionAdBreak.update).toHaveBeenCalledTimes(1);
  });

  it('refuses a call before the cue but counts one after a forward seek (P4-2, BR-33)', async () => {
    prisma.sessionAdBreak.findUnique.mockResolvedValue(breakRow());
    prisma.sessionAdBreak.update.mockResolvedValue(breakRow({ status: AdBreakStatus.PLAYED, playedAt: new Date() }));

    // Opening the movie and claiming every cue: far before the cue, no money.
    await expect(service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 0 })).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          details: expect.objectContaining({ reason: 'AD_BREAK_NOT_REACHED', cuePositionSeconds: 460 }),
        }),
      },
    );
    expect(prisma.sessionAdBreak.update).not.toHaveBeenCalled();

    // A seek far past the cue does not skip the ad: it plays now and counts.
    await expect(
      service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 900 }),
    ).resolves.toMatchObject({ status: 'PLAYED' });
    // Earlier pending cues jumped by the same seek are closed instead of stacking up.
    expect(prisma.sessionAdBreak.updateMany).toHaveBeenCalledWith({
      where: { streamingSessionId: 'sess-1', status: AdBreakStatus.SCHEDULED, positionSeconds: { lt: 460 } },
      data: { status: AdBreakStatus.SKIPPED },
    });
  });

  it('never replays a skipped cue', async () => {
    prisma.sessionAdBreak.findUnique.mockResolvedValue(breakRow({ status: AdBreakStatus.SKIPPED }));
    await expect(
      service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 460 }),
    ).resolves.toMatchObject({ status: 'SKIPPED' });
    expect(prisma.sessionAdBreak.update).not.toHaveBeenCalled();
  });

  it('names the latest pending cue the playhead passed as the ad due now', async () => {
    prisma.sessionAdBreak.findFirst.mockResolvedValue({ id: 'br-860' });
    await expect(service.dueBreakOf('sess-1', 900)).resolves.toBe('br-860');
    expect(prisma.sessionAdBreak.findFirst).toHaveBeenCalledWith({
      where: { streamingSessionId: 'sess-1', status: AdBreakStatus.SCHEDULED, positionSeconds: { lte: 900 } },
      orderBy: { positionSeconds: 'desc' },
      select: { id: true },
    });
    prisma.sessionAdBreak.findFirst.mockResolvedValue(null);
    await expect(service.dueBreakOf('sess-1', 10)).resolves.toBeNull();
  });

  it('never treats starting an ad as a completed view (P4-3)', async () => {
    prisma.sessionAdBreak.findUnique.mockResolvedValue(
      breakRow({ status: AdBreakStatus.PLAYED, playedAt: new Date() }),
    );
    await expect(service.markCompleted('sess-1', 'br-1', { userId: 'u-1' })).rejects.toMatchObject({
      response: expect.objectContaining({
        details: expect.objectContaining({ reason: 'AD_BREAK_NOT_FINISHED' }),
      }),
    });
    expect(prisma.sessionAdBreak.update).not.toHaveBeenCalled();
  });

  it('refuses completion before the break started', async () => {
    prisma.sessionAdBreak.findUnique.mockResolvedValue(breakRow());
    await expect(service.markCompleted('sess-1', 'br-1', { userId: 'u-1' })).rejects.toMatchObject({
      response: expect.objectContaining({
        details: expect.objectContaining({ reason: 'AD_BREAK_NOT_PLAYED' }),
      }),
    });
    expect(prisma.sessionAdBreak.update).not.toHaveBeenCalled();
  });

  it('records a completed view after the ad duration, idempotently (P4-3)', async () => {
    const playedAt = new Date(Date.now() - 14_000);
    prisma.sessionAdBreak.findUnique.mockResolvedValue(
      breakRow({ status: AdBreakStatus.PLAYED, playedAt, completedView: false }),
    );
    prisma.sessionAdBreak.update.mockResolvedValue(
      breakRow({ status: AdBreakStatus.PLAYED, playedAt, completedView: true }),
    );

    await expect(service.markCompleted('sess-1', 'br-1', { userId: 'u-1' })).resolves.toMatchObject({
      breakId: 'br-1',
      status: 'PLAYED',
      completedView: true,
    });
    expect(prisma.sessionAdBreak.update).toHaveBeenCalledWith({
      where: { id: 'br-1' },
      data: { completedView: true },
    });

    prisma.sessionAdBreak.findUnique.mockResolvedValue(
      breakRow({ status: AdBreakStatus.PLAYED, playedAt, completedView: true }),
    );
    await expect(service.markCompleted('sess-1', 'br-1', { userId: 'u-1' })).resolves.toMatchObject({
      completedView: true,
    });
    expect(prisma.sessionAdBreak.update).toHaveBeenCalledTimes(1);
  });

  it('refuses a cue of another session or another owner', async () => {
    prisma.sessionAdBreak.findUnique.mockResolvedValue(null);
    await expect(
      service.markPlayed('sess-1', 'missing', { userId: 'u-1' }, { positionSeconds: 460 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ reason: 'AD_BREAK_NOT_FOUND' }) }),
    });
    prisma.sessionAdBreak.findUnique.mockResolvedValue(breakRow({ streamingSessionId: 'sess-2' }));
    await expect(
      service.markPlayed('sess-1', 'br-1', { userId: 'u-1' }, { positionSeconds: 460 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ reason: 'AD_BREAK_NOT_FOUND' }) }),
    });
  });
});
