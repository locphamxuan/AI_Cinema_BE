import { StreamingEndReason, StreamingSessionStatus, type StreamingSession } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { WatchProgressService } from '../watch-progress/watch-progress.service';
import { sessionEnded } from './playback-events';
import { sessionNotActive } from './session-owner';
import { watchCreditSeconds } from './watch-pacing';

interface ViewingDeps {
  prisma: PrismaService;
  settings: PlatformSettingService;
  audit: AuditLogService;
  progress: WatchProgressService;
}

export interface ViewingUpdate {
  positionSeconds: number;
  /** The client's claim since the last update; it may only lower the server's credit. */
  watchedSeconds?: number;
  endReason: StreamingEndReason | null;
  /** false on a heartbeat inside the write window; stop and complete always pass true. */
  persistProgress: boolean;
}

/**
 * One viewing update: clamps the position to the cached media length, credits watch
 * time from the server clock, crosses the completion threshold from platform settings,
 * and — for members, on the cadence the caller asks for — persists the progress row.
 * Guests keep nothing.
 */
export async function saveViewing(
  deps: ViewingDeps,
  session: StreamingSession,
  input: ViewingUpdate,
): Promise<{ session: StreamingSession; completed: boolean }> {
  const now = new Date();
  // Watch time is credited from the server clock — the gap since the previous update on
  // this row — never by summing what the client claims; the claim only clamps it down.
  const credited = watchCreditSeconds(session.lastHeartbeatAt, now, input.watchedSeconds);
  // The media length was cached on the row at creation: no media_assets read per beat.
  const duration = session.durationSeconds;
  const position = duration
    ? Math.min(Math.max(0, Math.floor(input.positionSeconds)), duration)
    : Math.max(0, Math.floor(input.positionSeconds));
  const { episodeCompletionPercent } = await deps.settings.get();
  const reached = (seconds: number) =>
    Boolean(duration) && duration! > 0 && (seconds / duration!) * 100 >= episodeCompletionPercent;
  // Completion is always derived here, never asserted by the caller (P3-3).
  const completed = reached(position);
  // Crossing the threshold marks the episode completed but never closes the session: the
  // viewer is still watching the last minutes, so a beat keeps it open and only a stop or
  // complete call (or the expiry sweep) ends it. A viewer stop past the threshold is COMPLETED.
  const endReason =
    completed && input.endReason === StreamingEndReason.STOPPED ? StreamingEndReason.COMPLETED : input.endReason;
  // A session that ends now must leave its final position behind, and so must the beat that
  // first crosses the threshold; otherwise the once-a-minute cadence applies.
  const justCompleted = completed && !reached(session.lastPositionSeconds);
  const writeProgress = Boolean(session.userId) && (input.persistProgress || endReason !== null || justCompleted);

  const written = await deps.prisma.streamingSession.updateMany({
    // P3-2: the row may have been closed by a concurrent stop/complete after owned() read it.
    // Guard the write on ACTIVE so a late heartbeat cannot write a position onto an ENDED row.
    where: { id: session.id, status: StreamingSessionStatus.ACTIVE },
    data: {
      lastPositionSeconds: position,
      lastHeartbeatAt: now,
      totalWatchedSeconds: { increment: credited },
      ...(writeProgress ? { lastProgressAt: now } : {}),
      ...(endReason ? { status: StreamingSessionStatus.ENDED, endReason, endedAt: now } : {}),
    },
  });
  if (written.count === 0) sessionNotActive();
  // updateMany returns no row: rebuild the fields the response and the audit row read.
  const current: StreamingSession = {
    ...session,
    lastPositionSeconds: position,
    lastHeartbeatAt: now,
    totalWatchedSeconds: session.totalWatchedSeconds + credited,
    lastProgressAt: writeProgress ? now : session.lastProgressAt,
    ...(endReason ? { status: StreamingSessionStatus.ENDED, endReason, endedAt: now } : {}),
  };
  // Hardening #12: record the close right where it happens — the session row is deleted later.
  if (endReason) await deps.audit.record(sessionEnded(current, endReason));
  if (writeProgress && session.userId) {
    await deps.progress.save(session.userId, session.episodeId, {
      positionSeconds: position,
      durationSeconds: duration,
      completed,
      at: now,
    });
  }
  return { session: current, completed };
}
