import { ForbiddenException } from '@nestjs/common';
import { StreamingSessionStatus } from '@prisma/client';
import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { RunningPlanSnapshot } from 'src/modules/episode-access/subscription/running-plan';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { CountingDeviceEligibilityService, DEFAULT_MAX_DEVICES, maxDevicesOf } from './device-eligibility.port';

describe('maxDevicesOf (hardening #13)', () => {
  it.each([[1], [2], [10]])('accepts the positive integer %i', (value) => {
    expect(maxDevicesOf({ maxDevices: value })).toBe(value);
  });

  it('reads the key out of free-form feature JSON and ignores its neighbours', () => {
    expect(maxDevicesOf({ downloads: true, maxDevices: 4, note: null, nested: { maxDevices: 99 } })).toBe(4);
  });

  const unusable: Array<[string, unknown]> = [
    ['a missing row', null],
    ['an undefined row', undefined],
    ['a bare number', 3],
    ['a stringified JSON row', '{"maxDevices":3}'],
    ['a boolean row', true],
    ['an empty object', {}],
    ['a nested-only key', { limits: { maxDevices: 3 } }],
    ['a string value', { maxDevices: '3' }],
    ['a boolean value', { maxDevices: true }],
    ['a null value', { maxDevices: null }],
    ['a fractional value', { maxDevices: 2.5 }],
    ['zero', { maxDevices: 0 }],
    ['a negative value', { maxDevices: -2 }],
    ['NaN', { maxDevices: Number.NaN }],
    ['Infinity', { maxDevices: Number.POSITIVE_INFINITY }],
    ['an array value', { maxDevices: [2] }],
    ['an object value', { maxDevices: { value: 2 } }],
  ];

  it.each(unusable)('answers null for %s so the caller can fall back', (_label, features) => {
    expect(maxDevicesOf(features)).toBeNull();
  });
});

describe('CountingDeviceEligibilityService.check (hardening #13, P4-5)', () => {
  const prisma = {
    streamingSession: { count: jest.fn() },
  };
  const settings = { get: jest.fn() };
  const service = new CountingDeviceEligibilityService(
    prisma as unknown as PrismaService,
    settings as unknown as PlatformSettingService,
  );

  const runningPlan = (features: unknown = {}) => ({ code: 'MONTHLY', features }) as unknown as RunningPlanSnapshot;

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ playbackHeartbeatTimeoutSeconds: 90 });
    prisma.streamingSession.count.mockResolvedValue(0);
  });

  it('lets one more stream in while the plan has room', async () => {
    prisma.streamingSession.count.mockResolvedValue(2);
    await expect(service.check('u-1', runningPlan({ maxDevices: 3 }))).resolves.toBeUndefined();
  });

  it("reads maxDevices off the supplied plan snapshot and counts only this member's live sessions (P4-5)", async () => {
    await service.check('u-1', runningPlan({ maxDevices: 3 }));

    // The snapshot already carries the plan: this check performs no subscription read.
    expect(prisma.streamingSession.count).toHaveBeenCalledWith({
      where: { userId: 'u-1', status: StreamingSessionStatus.ACTIVE, lastHeartbeatAt: { gt: expect.any(Date) } },
    });
  });

  it('measures liveness from the heartbeat timeout setting, not from the status alone', async () => {
    const before = Date.now();
    await service.check('u-1', runningPlan({ maxDevices: 3 }));
    const after = Date.now();

    const calls = prisma.streamingSession.count.mock.calls as unknown[][];
    const { where } = calls[0][0] as { where: { lastHeartbeatAt: { gt: Date } } };
    // The cutoff sits one 90s window behind now: a stale row does not occupy a slot.
    expect(where.lastHeartbeatAt.gt.getTime()).toBeGreaterThanOrEqual(before - 90_000);
    expect(where.lastHeartbeatAt.gt.getTime()).toBeLessThanOrEqual(after - 90_000);
  });

  it('refuses the stream at the plan limit with the numbers on the error (step 11)', async () => {
    prisma.streamingSession.count.mockResolvedValue(3);

    await expect(service.check('u-1', runningPlan({ maxDevices: 3 }))).rejects.toThrow(ForbiddenException);
    await expect(service.check('u-1', runningPlan({ maxDevices: 3 }))).rejects.toMatchObject({
      response: expect.objectContaining({
        details: { reason: 'CONCURRENT_LIMIT_REACHED', maxDevices: 3, liveSessions: 3 },
      }),
    });
  });

  it('honours the plan value over the default floor of two', async () => {
    prisma.streamingSession.count.mockResolvedValue(1);

    await expect(service.check('u-1', runningPlan({ maxDevices: 1 }))).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ maxDevices: 1, liveSessions: 1 }) }),
    });
  });

  it('falls back to the default when the snapshot says the member has no plan', async () => {
    prisma.streamingSession.count.mockResolvedValue(DEFAULT_MAX_DEVICES - 1);
    await expect(service.check('u-1', null)).resolves.toBeUndefined();

    prisma.streamingSession.count.mockResolvedValue(DEFAULT_MAX_DEVICES);
    await expect(service.check('u-1', null)).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ maxDevices: DEFAULT_MAX_DEVICES }) }),
    });
  });

  it.each([
    ['no features row', null],
    ['an object without the key', {}],
    ['a stringified limit', { maxDevices: '3' }],
    ['a zero limit', { maxDevices: 0 }],
    ['a fractional limit', { maxDevices: 2.5 }],
  ])('falls back to the default on %s', async (_label, features) => {
    prisma.streamingSession.count.mockResolvedValue(DEFAULT_MAX_DEVICES - 1);
    await expect(service.check('u-1', runningPlan(features))).resolves.toBeUndefined();

    prisma.streamingSession.count.mockResolvedValue(DEFAULT_MAX_DEVICES);
    await expect(service.check('u-1', runningPlan(features))).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ maxDevices: DEFAULT_MAX_DEVICES }) }),
    });
  });

  it('runs on the creation transaction client when one is handed in (F-2)', async () => {
    const tx = {
      streamingSession: { count: jest.fn().mockResolvedValue(1) },
    };

    await service.check('u-1', runningPlan({ maxDevices: 2 }), tx as unknown as PrismaTx);

    expect(tx.streamingSession.count).toHaveBeenCalledWith({
      where: { userId: 'u-1', status: StreamingSessionStatus.ACTIVE, lastHeartbeatAt: { gt: expect.any(Date) } },
    });
    // The tx client answers the read; the top-level client is not touched.
    expect(prisma.streamingSession.count).not.toHaveBeenCalled();
  });
});
