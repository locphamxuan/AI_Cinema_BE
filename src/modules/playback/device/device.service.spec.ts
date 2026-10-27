import { NotFoundException } from '@nestjs/common';
import { StreamingEndReason, StreamingSessionStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { PlaybackAccessService } from '../playback-access/playback-access.service';
import { DeviceService } from './device.service';

describe('DeviceService (MF-4)', () => {
  const tx = {
    userDevice: { findFirst: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    streamingSession: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn((work: (db: typeof tx) => Promise<unknown>) => work(tx)) };
  const settings = { get: jest.fn().mockResolvedValue({ playbackHeartbeatTimeoutSeconds: 90 }) };
  const access = { runningPlanOf: jest.fn(), freePlanOf: jest.fn() };
  const audit = { recordMany: jest.fn() };
  const service = new DeviceService(
    prisma as unknown as PrismaService,
    settings as unknown as PlatformSettingService,
    access as unknown as PlaybackAccessService,
    audit as unknown as AuditLogService,
  );
  const live = {
    id: 's-1',
    userId: 'u-1',
    guestKey: null,
    episodeId: 'e-1',
    lastPositionSeconds: 30,
    totalWatchedSeconds: 30,
  };

  beforeEach(() => jest.clearAllMocks());

  it('lists devices with the current one flagged, live streams and the limits of the running plan', async () => {
    access.runningPlanOf.mockResolvedValue({
      code: 'MONTHLY',
      features: { maxRegisteredDevices: 4, maxConcurrentStreams: 2 },
    });
    tx.userDevice.findMany.mockResolvedValue([
      { id: 'd-1', deviceKey: 'k-1', name: 'iPhone', platform: 'IOS', createdAt: new Date(), lastSeenAt: new Date() },
      { id: 'd-2', deviceKey: 'k-2', name: 'Chrome', platform: 'WEB', createdAt: new Date(), lastSeenAt: new Date() },
    ]);
    tx.streamingSession.findMany.mockResolvedValue([
      {
        id: 's-1',
        deviceId: 'd-2',
        startedAt: new Date(),
        lastHeartbeatAt: new Date(),
        lastPositionSeconds: 42,
        episode: { id: 'e-1', title: 'Tập 1', episodeNumber: 1, movie: { title: 'Vùng dịch 704' } },
      },
    ]);

    const view = await service.overview('u-1', 'k-1');

    expect(access.freePlanOf).not.toHaveBeenCalled();
    expect(view.limits).toEqual({ maxRegisteredDevices: 4, maxConcurrentStreams: 2 });
    expect(view.devices.map((d) => [d.id, d.current])).toEqual([
      ['d-1', true],
      ['d-2', false],
    ]);
    expect(view.activeSessions).toEqual([
      expect.objectContaining({
        id: 's-1',
        deviceId: 'd-2',
        positionSeconds: 42,
        episode: expect.objectContaining({ movieTitle: 'Vùng dịch 704' }),
      }),
    ]);
  });

  it('falls back to the Free plan limits for a member without a running plan', async () => {
    access.runningPlanOf.mockResolvedValue(null);
    access.freePlanOf.mockResolvedValue({
      code: 'FREE',
      features: { maxRegisteredDevices: 2, maxConcurrentStreams: 1 },
    });
    tx.userDevice.findMany.mockResolvedValue([]);
    tx.streamingSession.findMany.mockResolvedValue([]);

    expect((await service.overview('u-1')).limits).toEqual({ maxRegisteredDevices: 2, maxConcurrentStreams: 1 });
  });

  it('removes a device after ending what it plays as KICKED', async () => {
    tx.userDevice.findFirst.mockResolvedValue({ id: 'd-1' });
    tx.streamingSession.findMany.mockResolvedValue([live]);

    await service.remove('u-1', 'd-1');

    expect(tx.streamingSession.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-1'] }, status: StreamingSessionStatus.ACTIVE },
      data: { status: StreamingSessionStatus.ENDED, endReason: StreamingEndReason.KICKED, endedAt: expect.any(Date) },
    });
    expect(audit.recordMany).toHaveBeenCalledWith([expect.objectContaining({ entityId: 's-1' })], tx);
    expect(tx.userDevice.delete).toHaveBeenCalledWith({ where: { id: 'd-1' } });
  });

  it("refuses another member's device and a stream that is not the caller's live one", async () => {
    tx.userDevice.findFirst.mockResolvedValue(null);
    await expect(service.remove('u-1', 'd-9')).rejects.toThrow(NotFoundException);
    expect(tx.userDevice.delete).not.toHaveBeenCalled();

    tx.streamingSession.findFirst.mockResolvedValue(null);
    await expect(service.endSession('u-1', 's-9')).rejects.toThrow(NotFoundException);
    expect(tx.streamingSession.updateMany).not.toHaveBeenCalled();
  });

  it("ends one of the member's live streams", async () => {
    tx.streamingSession.findFirst.mockResolvedValue(live);

    await service.endSession('u-1', 's-1');

    expect(tx.streamingSession.findFirst).toHaveBeenCalledWith({
      where: { id: 's-1', userId: 'u-1', status: StreamingSessionStatus.ACTIVE },
    });
    expect(tx.streamingSession.updateMany).toHaveBeenCalled();
  });
});
