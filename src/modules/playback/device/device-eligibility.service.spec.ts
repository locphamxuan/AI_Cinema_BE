import { ForbiddenException } from '@nestjs/common';
import { StreamingEndReason, StreamingSessionStatus } from '@prisma/client';
import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { RunningPlanSnapshot } from 'src/modules/episode-access/subscription/running-plan';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { DEFAULT_MAX_CONCURRENT_STREAMS } from '../playback-access/device-eligibility.port';
import type { WatchProgressService } from '../watch-progress/watch-progress.service';
import { DeviceEligibilityService } from './device-eligibility.service';

describe('DeviceEligibilityService.check (hardening #13, P4-5)', () => {
  const prisma = {
    streamingSession: { count: jest.fn() },
  };
  const settings = { get: jest.fn() };
  const audit = { recordMany: jest.fn() };
  const progress = { save: jest.fn() };
  const service = new DeviceEligibilityService(
    prisma as unknown as PrismaService,
    settings as unknown as PlatformSettingService,
    audit as unknown as AuditLogService,
    progress as unknown as WatchProgressService,
  );

  const runningPlan = (features: unknown = {}) => ({ code: 'MONTHLY', features }) as unknown as RunningPlanSnapshot;

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ playbackHeartbeatTimeoutSeconds: 90 });
    prisma.streamingSession.count.mockResolvedValue(0);
  });

  it('lets one more stream in while the plan has room', async () => {
    prisma.streamingSession.count.mockResolvedValue(2);
    await expect(service.check('u-1', runningPlan({ maxConcurrentStreams: 3 }))).resolves.toBeUndefined();
  });

  it("reads maxConcurrentStreams off the supplied plan snapshot and counts only this member's live sessions (P4-5)", async () => {
    await service.check('u-1', runningPlan({ maxConcurrentStreams: 3 }));

    // The snapshot already carries the plan: this check performs no subscription read.
    expect(prisma.streamingSession.count).toHaveBeenCalledWith({
      where: { userId: 'u-1', status: StreamingSessionStatus.ACTIVE, lastHeartbeatAt: { gt: expect.any(Date) } },
    });
  });

  it('measures liveness from the heartbeat timeout setting, not from the status alone', async () => {
    const before = Date.now();
    await service.check('u-1', runningPlan({ maxConcurrentStreams: 3 }));
    const after = Date.now();

    const calls = prisma.streamingSession.count.mock.calls as unknown[][];
    const { where } = calls[0][0] as { where: { lastHeartbeatAt: { gt: Date } } };
    // The cutoff sits one 90s window behind now: a stale row does not occupy a slot.
    expect(where.lastHeartbeatAt.gt.getTime()).toBeGreaterThanOrEqual(before - 90_000);
    expect(where.lastHeartbeatAt.gt.getTime()).toBeLessThanOrEqual(after - 90_000);
  });

  it('refuses the stream at the plan limit with the numbers on the error (step 11)', async () => {
    prisma.streamingSession.count.mockResolvedValue(3);

    await expect(service.check('u-1', runningPlan({ maxConcurrentStreams: 3 }))).rejects.toThrow(ForbiddenException);
    await expect(service.check('u-1', runningPlan({ maxConcurrentStreams: 3 }))).rejects.toMatchObject({
      response: expect.objectContaining({
        details: { reason: 'CONCURRENT_LIMIT_REACHED', maxConcurrentStreams: 3, liveSessions: 3 },
      }),
    });
  });

  it('honours the plan value over the default floor of two', async () => {
    prisma.streamingSession.count.mockResolvedValue(1);

    await expect(service.check('u-1', runningPlan({ maxConcurrentStreams: 1 }))).rejects.toMatchObject({
      response: expect.objectContaining({
        details: expect.objectContaining({ maxConcurrentStreams: 1, liveSessions: 1 }),
      }),
    });
  });

  it('falls back to the default when the snapshot says the member has no plan', async () => {
    prisma.streamingSession.count.mockResolvedValue(DEFAULT_MAX_CONCURRENT_STREAMS - 1);
    await expect(service.check('u-1', null)).resolves.toBeUndefined();

    prisma.streamingSession.count.mockResolvedValue(DEFAULT_MAX_CONCURRENT_STREAMS);
    await expect(service.check('u-1', null)).rejects.toMatchObject({
      response: expect.objectContaining({
        details: expect.objectContaining({ maxConcurrentStreams: DEFAULT_MAX_CONCURRENT_STREAMS }),
      }),
    });
  });

  it.each([
    ['no features row', null],
    ['an object without the key', {}],
    ['a stringified limit', { maxConcurrentStreams: '3' }],
    ['a zero limit', { maxConcurrentStreams: 0 }],
    ['a fractional limit', { maxConcurrentStreams: 2.5 }],
  ])('falls back to the default on %s', async (_label, features) => {
    prisma.streamingSession.count.mockResolvedValue(DEFAULT_MAX_CONCURRENT_STREAMS - 1);
    await expect(service.check('u-1', runningPlan(features))).resolves.toBeUndefined();

    prisma.streamingSession.count.mockResolvedValue(DEFAULT_MAX_CONCURRENT_STREAMS);
    await expect(service.check('u-1', runningPlan(features))).rejects.toMatchObject({
      response: expect.objectContaining({
        details: expect.objectContaining({ maxConcurrentStreams: DEFAULT_MAX_CONCURRENT_STREAMS }),
      }),
    });
  });

  it('runs on the creation transaction client when one is handed in (F-2)', async () => {
    const tx = {
      streamingSession: { count: jest.fn().mockResolvedValue(1) },
    };

    await service.check('u-1', runningPlan({ maxConcurrentStreams: 2 }), tx as unknown as PrismaTx);

    expect(tx.streamingSession.count).toHaveBeenCalledWith({
      where: { userId: 'u-1', status: StreamingSessionStatus.ACTIVE, lastHeartbeatAt: { gt: expect.any(Date) } },
    });
    // The tx client answers the read; the top-level client is not touched.
    expect(prisma.streamingSession.count).not.toHaveBeenCalled();
  });

  it('stops what this device still plays before counting, so switching episodes never hits the limit', async () => {
    const playing = {
      id: 's-old',
      userId: 'u-1',
      guestKey: null,
      episodeId: 'ep-1',
      lastPositionSeconds: 40,
      totalWatchedSeconds: 40,
      durationSeconds: 600,
    };
    const tx = {
      streamingSession: {
        findMany: jest.fn().mockResolvedValue([playing]),
        updateMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    await service.check('u-1', runningPlan({ maxConcurrentStreams: 1 }), tx as unknown as PrismaTx, 'dev-1');

    expect(tx.streamingSession.findMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', deviceId: 'dev-1', status: StreamingSessionStatus.ACTIVE },
    });
    expect(tx.streamingSession.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-old'] }, status: StreamingSessionStatus.ACTIVE },
      data: { status: StreamingSessionStatus.ENDED, endReason: StreamingEndReason.STOPPED, endedAt: expect.any(Date) },
    });
    expect(audit.recordMany).toHaveBeenCalledWith([expect.objectContaining({ entityId: 's-old' })], tx);
    expect(progress.save).toHaveBeenCalledWith('u-1', 'ep-1', {
      positionSeconds: 40,
      durationSeconds: 600,
      completed: false,
      at: expect.any(Date),
    });
    expect(tx.streamingSession.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.streamingSession.count.mock.invocationCallOrder[0],
    );
  });
});

describe('DeviceEligibilityService.register (MF-4 §4.4.1)', () => {
  const KEY = '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33';
  const tx = {
    $executeRaw: jest.fn(),
    userDevice: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn(), create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn((work: (db: typeof tx) => Promise<unknown>) => work(tx)) };
  const service = new DeviceEligibilityService(
    prisma as unknown as PrismaService,
    {} as PlatformSettingService,
    {} as AuditLogService,
    {} as WatchProgressService,
  );
  const plan = { code: 'FREE', features: { maxRegisteredDevices: 2 } } as unknown as RunningPlanSnapshot;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.userDevice.findUnique.mockResolvedValue(null);
    tx.userDevice.count.mockResolvedValue(0);
    tx.userDevice.create.mockResolvedValue({ id: 'dev-new' });
  });

  it.each([[undefined], [{ key: 'not-a-uuid' }]])(
    'refuses a member without a UUID v4 device id (%p)',
    async (device) => {
      await expect(service.register('u-1', device, plan)).rejects.toMatchObject({
        response: expect.objectContaining({ details: { reason: 'DEVICE_ID_REQUIRED' } }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('refreshes a known device without counting it against the limit', async () => {
    tx.userDevice.findUnique.mockResolvedValue({ id: 'dev-1' });

    await expect(service.register('u-1', { key: KEY, name: ' Pixel 8 ', platform: 'android' }, plan)).resolves.toBe(
      'dev-1',
    );

    expect(tx.userDevice.update).toHaveBeenCalledWith({
      where: { id: 'dev-1' },
      data: { lastSeenAt: expect.any(Date), platform: 'ANDROID', name: 'Pixel 8' },
    });
    expect(tx.userDevice.count).not.toHaveBeenCalled();
  });

  it('registers a new device while the plan has room, serialized per member', async () => {
    tx.userDevice.count.mockResolvedValue(1);

    await expect(service.register('u-1', { key: KEY, platform: 'tv' }, plan)).resolves.toBe('dev-new');

    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.userDevice.create).toHaveBeenCalledWith({
      data: { userId: 'u-1', deviceKey: KEY, name: 'Thiết bị chưa đặt tên', platform: 'OTHER' },
    });
  });

  it('refuses a new device at the plan limit with the numbers on the error', async () => {
    tx.userDevice.count.mockResolvedValue(2);

    await expect(service.register('u-1', { key: KEY }, plan)).rejects.toMatchObject({
      response: expect.objectContaining({
        details: { reason: 'DEVICE_LIMIT_REACHED', maxRegisteredDevices: 2, registeredDevices: 2 },
      }),
    });
    expect(tx.userDevice.create).not.toHaveBeenCalled();
  });
});
