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
    streamingSession: { findMany: jest.fn(), updateManyAndReturn: jest.fn() },
  };
  const settings = {
    get: jest.fn().mockResolvedValue({ playbackHeartbeatTimeoutSeconds: 90, episodeCompletionPercent: 90 }),
  };
  const progress = { save: jest.fn() };
  const audit = { recordMany: jest.fn() };
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
    lastHeartbeatAt: new Date('2026-10-15T09:50:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // mockReset drops any unconsumed mockResolvedValueOnce queue a previous test left behind.
    prisma.streamingSession.findMany.mockReset().mockResolvedValue([]);
    // The guarded UPDATE returns only the rows it actually closed; a heartbeat can save the rest.
    prisma.streamingSession.updateManyAndReturn.mockReset().mockResolvedValue([]);
  });

  it('closes timed-out sessions and saves the member position (step 21)', async () => {
    prisma.streamingSession.findMany.mockResolvedValueOnce([stale()]);
    prisma.streamingSession.updateManyAndReturn.mockResolvedValueOnce([stale()]);
    await expect(sweep.expireDue(new Date('2026-10-15T10:00:00.000Z'))).resolves.toEqual({ sessions: 1 });
    expect(prisma.streamingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: StreamingSessionStatus.ACTIVE,
          lastHeartbeatAt: { lte: expect.any(Date) },
        }),
      }),
    );
    expect(prisma.streamingSession.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['sess-1'] },
          status: StreamingSessionStatus.ACTIVE,
          // Re-checked at UPDATE time: a heartbeat between SELECT and UPDATE keeps the row open.
          lastHeartbeatAt: { lte: new Date('2026-10-15T09:58:30.000Z') },
        },
        data: expect.objectContaining({ status: StreamingSessionStatus.ENDED, endReason: StreamingEndReason.EXPIRED }),
      }),
    );
    expect(progress.save).toHaveBeenCalledWith(
      'u-1',
      'ep-1',
      expect.objectContaining({ positionSeconds: 300, completed: false }),
    );
    // Hardening #12: the close is recorded durably for later investigations.
    expect(audit.recordMany).toHaveBeenCalledWith([
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
    ]);
  });

  it('closes a whole page with one guarded UPDATE and one audit INSERT (P5-1)', async () => {
    const page = [
      stale({ id: 'sess-a', userId: 'u-a', episodeId: 'ep-a' }),
      stale({ id: 'sess-b', userId: 'u-b', episodeId: 'ep-b' }),
    ];
    prisma.streamingSession.findMany.mockResolvedValueOnce(page);
    prisma.streamingSession.updateManyAndReturn.mockResolvedValueOnce(page);

    await expect(sweep.expireDue()).resolves.toEqual({ sessions: 2 });

    expect(prisma.streamingSession.updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(prisma.streamingSession.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['sess-a', 'sess-b'] },
          status: StreamingSessionStatus.ACTIVE,
        }),
      }),
    );
    expect(audit.recordMany).toHaveBeenCalledTimes(1);
    const [entries] = audit.recordMany.mock.calls[0] as [unknown[]];
    expect(entries).toHaveLength(2);
    expect(progress.save).toHaveBeenCalledTimes(2);
  });

  it('saves progress only for rows the guarded UPDATE actually closed (P5-1)', async () => {
    const closed = stale({ id: 'sess-a', userId: 'u-a', episodeId: 'ep-a' });
    const heartbeatSaved = stale({ id: 'sess-b', userId: 'u-b', episodeId: 'ep-b' });
    prisma.streamingSession.findMany.mockResolvedValueOnce([closed, heartbeatSaved]);
    prisma.streamingSession.updateManyAndReturn.mockResolvedValueOnce([closed]);

    await expect(sweep.expireDue()).resolves.toEqual({ sessions: 1 });

    expect(progress.save).toHaveBeenCalledTimes(1);
    expect(progress.save).toHaveBeenCalledWith('u-a', 'ep-a', expect.objectContaining({ positionSeconds: 300 }));
    const [entries] = audit.recordMany.mock.calls[0] as [unknown[]];
    expect(entries).toEqual([expect.objectContaining({ entityId: 'sess-a' })]);
  });

  it('skips a row a heartbeat already saved and keeps guests progress-free', async () => {
    prisma.streamingSession.findMany.mockResolvedValueOnce([stale({ id: 'sess-2', userId: null })]);
    await expect(sweep.expireDue()).resolves.toEqual({ sessions: 0 });
    expect(progress.save).not.toHaveBeenCalled();
    // The row is still ACTIVE for someone else: no false ENDED event.
    expect(audit.recordMany).not.toHaveBeenCalled();
  });

  it('records the sweep close with the guest key in the payload (hardening #12)', async () => {
    const guest = stale({ id: 'sess-3', userId: null, guestKey: 'g-1' });
    prisma.streamingSession.findMany.mockResolvedValueOnce([guest]);
    prisma.streamingSession.updateManyAndReturn.mockResolvedValueOnce([guest]);
    await expect(sweep.expireDue()).resolves.toEqual({ sessions: 1 });

    expect(audit.recordMany).toHaveBeenCalledWith([
      expect.objectContaining({
        action: 'PLAYBACK_SESSION_ENDED',
        entityId: 'sess-3',
        actorId: null,
        payload: expect.objectContaining({ endReason: 'EXPIRED', guestKey: 'g-1', totalWatchedSeconds: 600 }),
      }),
    ]);
    expect(progress.save).not.toHaveBeenCalled();
  });

  it('writes one progress row per member/episode, keeping the newest heartbeat (P5-1)', async () => {
    const older = stale({ id: 'sess-old', lastPositionSeconds: 100 });
    const newer = stale({
      id: 'sess-new',
      lastPositionSeconds: 500,
      lastHeartbeatAt: new Date('2026-10-15T09:55:00.000Z'),
    });
    prisma.streamingSession.findMany.mockResolvedValueOnce([older, newer]);
    prisma.streamingSession.updateManyAndReturn.mockResolvedValueOnce([older, newer]);

    await expect(sweep.expireDue()).resolves.toEqual({ sessions: 2 });

    expect(progress.save).toHaveBeenCalledTimes(1);
    expect(progress.save).toHaveBeenCalledWith('u-1', 'ep-1', expect.objectContaining({ positionSeconds: 500 }));
    // Both sessions still get their own audit row.
    const [entries] = audit.recordMany.mock.calls[0] as [unknown[]];
    expect(entries).toHaveLength(2);
  });

  it('keeps saving the rest of the page when one progress write fails (P5-1)', async () => {
    const page = [
      stale({ id: 'sess-a', userId: 'u-a', episodeId: 'ep-a' }),
      stale({ id: 'sess-b', userId: 'u-b', episodeId: 'ep-b' }),
    ];
    prisma.streamingSession.findMany.mockResolvedValueOnce(page);
    prisma.streamingSession.updateManyAndReturn.mockResolvedValueOnce(page);
    progress.save.mockRejectedValueOnce(new Error('deadlock')).mockResolvedValueOnce(undefined);

    // The sessions are already ENDED: a failed position must not abort the remaining rows.
    await expect(sweep.expireDue()).resolves.toEqual({ sessions: 2 });

    expect(progress.save).toHaveBeenCalledTimes(2);
    expect(audit.recordMany).toHaveBeenCalledTimes(1);
  });

  it('skips a tick while the previous sweep is still draining (P5-1)', async () => {
    let releaseSettings!: (value: {
      playbackHeartbeatTimeoutSeconds: number;
      episodeCompletionPercent: number;
    }) => void;
    settings.get.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseSettings = resolve;
      }),
    );

    const first = sweep.expireDue();
    // The second tick sees `running` set and returns without touching the database.
    await expect(sweep.expireDue()).resolves.toEqual({ sessions: 0 });
    expect(prisma.streamingSession.findMany).not.toHaveBeenCalled();

    releaseSettings({ playbackHeartbeatTimeoutSeconds: 90, episodeCompletionPercent: 90 });
    await expect(first).resolves.toEqual({ sessions: 0 });
    expect(prisma.streamingSession.findMany).toHaveBeenCalledTimes(1);

    // The guard is released in `finally`, so the next tick runs normally.
    await expect(sweep.expireDue()).resolves.toEqual({ sessions: 0 });
    expect(prisma.streamingSession.findMany).toHaveBeenCalledTimes(2);
  });
});
