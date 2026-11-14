/** Shared mocks of StreamingSessionService for its spec files; not a test itself. */
import { PlaybackAccessType, StreamingSessionStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { PlaybackAccessService } from '../playback-access/playback-access.service';
import type { WatchProgressService } from '../watch-progress/watch-progress.service';
import type { AdBreakService } from '../ad-break/ad-break.service';
import type { PlaybackUrlService } from './playback-url.service';
import { StreamingSessionService } from './streaming-session.service';

export function sessionHarness() {
  const streamingSession = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const tx = {
    streamingSession,
    mediaAsset: { findUnique: jest.fn() },
    episode: { findUnique: jest.fn(), findFirst: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const prisma = {
    streamingSession,
    mediaAsset: { findUnique: jest.fn() },
    episode: { findUnique: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn((work: (db: typeof tx) => Promise<never>) => work(tx)),
  };
  const access = {
    verify: jest.fn(),
    runningPlanOf: jest.fn(),
    freePlanOf: jest.fn().mockResolvedValue(null),
    stillEntitled: jest.fn(),
  };
  const devices = { register: jest.fn(), check: jest.fn() };
  const settings = {
    get: jest.fn().mockResolvedValue({ playbackHeartbeatTimeoutSeconds: 90, episodeCompletionPercent: 90 }),
  };
  const urls = { masterUrl: jest.fn().mockReturnValue('https://api.example/api/playback/s/sess-1/master.m3u8?s=x') };
  const progress = { progress: jest.fn(), save: jest.fn() };
  const ads = { scheduleFor: jest.fn(), scheduleOf: jest.fn(), dueBreakOf: jest.fn().mockResolvedValue(null) };
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
    streamUrl: 'https://cdn.example/hls/asset-1/master.m3u8',
    qualities: ['360p'],
    durationSeconds: 600,
    accessType: PlaybackAccessType.SUBSCRIPTION,
    planCode: 'MONTHLY',
    subtitles: [],
    aiLabel: null,
  };

  const runningPlan = { code: 'MONTHLY', features: { maxDevices: 2, adFree: false } };

  const reset = () => {
    jest.clearAllMocks();
    access.verify.mockResolvedValue(verified);
    access.runningPlanOf.mockResolvedValue(runningPlan);
    access.stillEntitled.mockResolvedValue(true);
    devices.register.mockResolvedValue('dev-1');
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
  };
  return {
    service,
    prisma,
    tx,
    access,
    devices,
    settings,
    progress,
    ads,
    audit,
    verified,
    runningPlan,
    reset,
  };
}
