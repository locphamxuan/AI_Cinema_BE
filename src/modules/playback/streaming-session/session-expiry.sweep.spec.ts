import { StreamingEndReason, StreamingSessionStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { WatchProgressService } from '../watch-progress/watch-progress.service';
import { SessionExpirySweep } from './session-expiry.sweep';

describe('SessionExpirySweep.expireDue', () => {
  const prisma = {
    streamingSession: { findMany: jest.fn(), updateMany: jest.fn() },
  };
  const settings = {
    get: jest.fn().mockResolvedValue({ playbackHeartbeatTimeoutSeconds: 90, episodeCompletionPercent: 90 }),
  };
  const progress = { save: jest.fn() };
  const audit = { record: jest.fn() };
  const queue = { every: jest.fn() };
  const config = { schedules: { streamingSessionSweepMs: 30000 } } as unknown as AppConfig;
  const sweep = new SessionExpirySweep(
    prisma as unknown as PrismaService,
    settings as unknown as PlatformSettingService,
    progress as unknown as WatchProgressService,
    audit as unknown as AuditLogService,
    queue as unknown as JobQueue,
    config,
  );

  const stale = (overrides = {}) => ({
    id: 'sess-1',
    userId: 'u-1',
    guestKey: null,
    episodeId: 'ep-1',
    lastPositionSeconds: 300,
    totalWatchedSeconds: 600,
    // Cached on the row at session creation; the sweep does not join media_assets.
    durationSeconds: 1200,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // mockReset drops any unconsumed mockResolvedValueOnce queue a previous test left behind.
    prisma.streamingSession.findMany.mockReset().mockResolvedValue([]);
    prisma.streamingSession.updateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it('closes timed-out sessions and saves the member position (step 21)', async () => {
    prisma.streamingSession.findMany.mockResolvedValueOnce([stale()]).mockResolvedValueOnce([]);
    await expect(sweep.expireDue(new Date('2026-10-15T10:00:00.000Z'))).resolves.toEqual({ sessions: 1 });
    expect(prisma.streamingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: StreamingSessionStatus.ACTIVE,
          lastHeartbeatAt: { lte: expect.any(Date) },
        }),
      }),
    );
    expect(prisma.streamingSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-1', status: StreamingSessionStatus.ACTIVE },
        data: expect.objectContaining({ status: StreamingSessionStatus.ENDED, endReason: StreamingEndReason.EXPIRED }),
      }),
    );
    expect(progress.save).toHaveBeenCalledWith(
      'u-1',
      'ep-1',
      expect.objectContaining({ positionSeconds: 300, completed: false }),
    );
    // Hardening #12: the close is recorded durably for later investigations.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLAYBACK_SESSION_ENDED',
        entityType: 'StreamingSession',
        entityId: 'sess-1',
        actorId: null,
        payload: expect.objectContaining({
          endReason: 'EXPIRED',
          positionSeconds: 300,
          totalWatchedSeconds: 600,
          userId: 'u-1',
        }),
      }),
    );
  });

  it('skips a row a heartbeat already saved and keeps guests progress-free', async () => {
    prisma.streamingSession.findMany.mockResolvedValueOnce([stale({ id: 'sess-2', userId: null })]);
    prisma.streamingSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(sweep.expireDue()).resolves.toEqual({ sessions: 0 });
    expect(progress.save).not.toHaveBeenCalled();
    // The row is still ACTIVE for someone else: no false ENDED event.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records the sweep close with the guest key in the payload (hardening #12)', async () => {
    prisma.streamingSession.findMany.mockResolvedValueOnce([stale({ id: 'sess-3', userId: null, guestKey: 'g-1' })]);
    await expect(sweep.expireDue()).resolves.toEqual({ sessions: 1 });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLAYBACK_SESSION_ENDED',
        entityId: 'sess-3',
        actorId: null,
        payload: expect.objectContaining({ endReason: 'EXPIRED', guestKey: 'g-1', totalWatchedSeconds: 600 }),
      }),
    );
    expect(progress.save).not.toHaveBeenCalled();
  });
});
