import { PlaybackAccessType, StreamingEndReason, StreamingSessionStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { PlaybackAccessService } from '../playback-access/playback-access.service';
import type { WatchProgressService } from '../watch-progress/watch-progress.service';
import type { AdBreakService } from '../ad-break/ad-break.service';
import type { PlaybackUrlService } from './playback-url.service';
import { sessionEnded, sessionStarted } from './playback-events';
import { StreamingSessionService } from './streaming-session.service';

interface Row {
  id: string;
  userId: string | null;
  guestKey: string | null;
  episodeId: string;
  mediaAssetId: string;
  accessType: PlaybackAccessType;
  status: StreamingSessionStatus;
  startPositionSeconds: number;
  lastPositionSeconds: number;
  totalWatchedSeconds: number;
  lastProgressAt: Date | null;
  lastHeartbeatAt: Date;
  durationSeconds: number | null;
  ipAddress: string | null;
}

const row = (overrides: Partial<Row> = {}): Row => ({
  id: 'sess-1',
  userId: 'u-1',
  guestKey: null,
  episodeId: 'ep-1',
  mediaAssetId: 'asset-1',
  accessType: PlaybackAccessType.PLAN,
  status: StreamingSessionStatus.ACTIVE,
  startPositionSeconds: 0,
  lastPositionSeconds: 300,
  totalWatchedSeconds: 600,
  lastProgressAt: null,
  lastHeartbeatAt: new Date(Date.now() - 12_000),
  durationSeconds: 1200,
  ipAddress: '203.0.113.7',
  ...overrides,
});

describe('playback audit rows (hardening #12)', () => {
  describe('sessionStarted', () => {
    it('names the viewer, the episode and the access type', () => {
      expect(sessionStarted(row())).toMatchObject({
        action: 'PLAYBACK_SESSION_STARTED',
        entityType: 'StreamingSession',
        entityId: 'sess-1',
        movieId: null,
        actorId: 'u-1',
        payload: { episodeId: 'ep-1', accessType: 'PLAN', userId: 'u-1', ipAddress: '203.0.113.7' },
      });
    });

    it('marks a guest row as GUEST and keeps the guest key', () => {
      expect(sessionStarted(row({ userId: null, guestKey: 'g-1' }))).toMatchObject({
        actorId: null,
        actorType: 'GUEST',
        payload: { guestKey: 'g-1' },
      });
    });
  });

  describe('sessionEnded', () => {
    it('carries the reason, the final position and the watch time', () => {
      expect(sessionEnded(row(), StreamingEndReason.STOPPED)).toMatchObject({
        action: 'PLAYBACK_SESSION_ENDED',
        entityType: 'StreamingSession',
        entityId: 'sess-1',
        movieId: null,
        actorId: 'u-1',
        payload: {
          episodeId: 'ep-1',
          endReason: 'STOPPED',
          positionSeconds: 300,
          totalWatchedSeconds: 600,
          userId: 'u-1',
        },
      });
    });

    it('marks a guest close as GUEST', () => {
      const entry = sessionEnded(row({ userId: null, guestKey: 'g-1' }), StreamingEndReason.COMPLETED);
      expect(entry).toMatchObject({ actorId: null, actorType: 'GUEST', payload: { guestKey: 'g-1' } });
    });

    it('blames the sweep, not the viewer, for a system close — viewer stays in the payload', () => {
      const entry = sessionEnded(row(), StreamingEndReason.EXPIRED, 'SYSTEM');
      expect(entry).toMatchObject({ actorId: null, payload: { endReason: 'EXPIRED', userId: 'u-1' } });
      expect(entry.actorType).toBeUndefined();
    });
  });

  describe('StreamingSessionService wiring', () => {
    const streamingSession = {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const tx = { streamingSession, $executeRaw: jest.fn() };
    const prisma = {
      streamingSession,
      mediaAsset: { findUnique: jest.fn() },
      episode: { findUnique: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn((work: (db: typeof tx) => Promise<never>) => work(tx)),
    };
    const access = { verify: jest.fn(), stillEntitled: jest.fn() };
    const devices = { check: jest.fn() };
    const settings = {
      get: jest.fn().mockResolvedValue({ playbackHeartbeatTimeoutSeconds: 90, episodeCompletionPercent: 90 }),
    };
    const urls = { masterUrl: jest.fn().mockReturnValue('https://api.example/master.m3u8') };
    const progress = { progress: jest.fn(), save: jest.fn() };
    const ads = { scheduleFor: jest.fn(), scheduleOf: jest.fn() };
    const audit = { record: jest.fn() };
    const service = new StreamingSessionService(
      prisma as unknown as PrismaService,
      access as unknown as PlaybackAccessService,
      devices,
      settings as unknown as PlatformSettingService,
      urls as unknown as PlaybackUrlService,
      progress as unknown as WatchProgressService,
      ads as unknown as AdBreakService,
      audit as unknown as AuditLogService,
    );

    const verified = {
      episodeId: 'ep-1',
      movieId: 'm-1',
      mediaAssetId: 'asset-1',
      isSelfHosted: true,
      streamUrl: 'https://cdn.example/hls/master.m3u8',
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
      access.stillEntitled.mockResolvedValue(true);
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

    it('records STARTED in the creation transaction, once', async () => {
      await service.create({ episodeId: 'ep-1', userId: 'u-1' });

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PLAYBACK_SESSION_STARTED',
          entityId: 'sess-1',
          actorId: 'u-1',
        }),
        tx,
      );
    });

    it('reuses a live session without a second STARTED row', async () => {
      prisma.streamingSession.findFirst.mockResolvedValueOnce(row({ id: 'sess-live' }));
      await service.create({ episodeId: 'ep-1', userId: 'u-1' });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('records ENDED/SUPERSEDED plus the fresh STARTED when a row is rotated', async () => {
      prisma.streamingSession.findFirst.mockResolvedValueOnce(
        row({ id: 'sess-old', mediaAssetId: 'asset-0', lastPositionSeconds: 120, totalWatchedSeconds: 240 }),
      );
      await service.create({ episodeId: 'ep-1', userId: 'u-1' });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PLAYBACK_SESSION_ENDED',
          entityId: 'sess-old',
          payload: expect.objectContaining({ endReason: 'SUPERSEDED', positionSeconds: 120, totalWatchedSeconds: 240 }),
        }),
        tx,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PLAYBACK_SESSION_STARTED', entityId: 'sess-1' }),
        tx,
      );
    });

    describe('viewing updates', () => {
      let current: Row;

      beforeEach(() => {
        current = row();
        prisma.streamingSession.findUnique.mockImplementation(() => Promise.resolve(current));
        prisma.streamingSession.updateMany.mockResolvedValue({ count: 1 });
      });

      it('records STOPPED with the final position when the viewer stops', async () => {
        await service.stop('sess-1', { userId: 'u-1' }, { positionSeconds: 360 });

        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'PLAYBACK_SESSION_ENDED',
            entityId: 'sess-1',
            actorId: 'u-1',
            payload: expect.objectContaining({ episodeId: 'ep-1', endReason: 'STOPPED', positionSeconds: 360 }),
          }),
        );
      });

      it('records KICKED when the entitlement vanished mid-session (#11)', async () => {
        access.stillEntitled.mockResolvedValue(false);

        await expect(service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 420 })).rejects.toThrow();
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({ payload: expect.objectContaining({ endReason: 'KICKED', positionSeconds: 420 }) }),
        );
      });

      it('leaves plain beats unrecorded and records the threshold crossing', async () => {
        await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 320 });
        expect(audit.record).not.toHaveBeenCalled();

        await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 1100 });
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({ payload: expect.objectContaining({ endReason: 'COMPLETED' }) }),
        );
      });

      it('records a guest close as GUEST', async () => {
        current = row({ userId: null, guestKey: 'g-1' });

        await service.stop('sess-1', { guestKey: 'g-1' }, { positionSeconds: 400 });
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: null,
            actorType: 'GUEST',
            payload: expect.objectContaining({ endReason: 'STOPPED', guestKey: 'g-1' }),
          }),
        );
      });
    });
  });
});
