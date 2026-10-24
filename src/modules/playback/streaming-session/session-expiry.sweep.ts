import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { StreamingEndReason, StreamingSessionStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { WatchProgressService } from '../watch-progress/watch-progress.service';
import { sessionEnded } from './playback-events';

const BATCH = 500;

/**
 * Flow 3, step 21 for viewers who just close the app: ACTIVE sessions whose
 * heartbeat timed out are closed as EXPIRED, and the member's last position is
 * saved so nothing watched is lost. The device slot frees with the row.
 *
 * P5-1: a tick that lands while the previous one is still draining is skipped,
 * and each page is closed by one guarded UPDATE (RETURNING the rows it actually
 * closed) instead of one UPDATE per session. Progress is still an upsert per
 * member/episode, but only after the page has been closed.
 */
@Injectable()
export class SessionExpirySweep implements OnModuleInit {
  private readonly logger = new Logger(SessionExpirySweep.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
    private readonly progress: WatchProgressService,
    private readonly audit: AuditLogService,
    private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every('streaming-session-expire.sweep', this.config.schedules.streamingSessionSweepMs, () =>
      this.expireDue().then(() => undefined),
    );
  }

  /** Closes every timed-out session; returns how many rows were closed. */
  async expireDue(now = new Date()): Promise<{ sessions: number }> {
    if (this.running) {
      this.logger.warn('Previous expiry sweep is still running; skipping this tick');
      return { sessions: 0 };
    }
    this.running = true;
    try {
      return await this.closeDue(now);
    } finally {
      this.running = false;
    }
  }

  private async closeDue(now: Date): Promise<{ sessions: number }> {
    const { playbackHeartbeatTimeoutSeconds, episodeCompletionPercent } = await this.settings.get();
    const cutoff = new Date(now.getTime() - playbackHeartbeatTimeoutSeconds * 1000);
    let sessions = 0;
    for (;;) {
      const due = await this.prisma.streamingSession.findMany({
        where: { status: StreamingSessionStatus.ACTIVE, lastHeartbeatAt: { lte: cutoff } },
        orderBy: { lastHeartbeatAt: 'asc' },
        take: BATCH,
      });
      if (!due.length) break;
      // A heartbeat may land while this page waits: the guard keeps the row ACTIVE, and
      // RETURNING names exactly the rows this statement closed — never the saved ones.
      const closed = await this.prisma.streamingSession.updateManyAndReturn({
        where: { id: { in: due.map((session) => session.id) }, status: StreamingSessionStatus.ACTIVE },
        data: {
          status: StreamingSessionStatus.ENDED,
          endReason: StreamingEndReason.EXPIRED,
          endedAt: now,
        },
        // Only the columns the audit row and the progress upsert read.
        select: {
          id: true,
          userId: true,
          guestKey: true,
          episodeId: true,
          lastPositionSeconds: true,
          totalWatchedSeconds: true,
          durationSeconds: true,
        },
      });
      if (closed.length) {
        sessions += closed.length;
        // Hardening #12: the row is retention-deleted later; this is the durable record.
        // P5-1: one INSERT per page instead of one per session.
        await this.audit.recordMany(
          closed.map((session) => sessionEnded(session, StreamingEndReason.EXPIRED, 'SYSTEM')),
        );
        for (const session of closed) {
          if (!session.userId) continue;
          // The length was cached on the row at creation; no join back to media_assets.
          const duration = session.durationSeconds;
          const completed =
            Boolean(duration) &&
            duration! > 0 &&
            (session.lastPositionSeconds / duration!) * 100 >= episodeCompletionPercent;
          await this.progress.save(session.userId, session.episodeId, {
            positionSeconds: session.lastPositionSeconds,
            durationSeconds: duration,
            completed,
            at: now,
          });
        }
      }
      if (due.length < BATCH) break;
    }
    if (sessions) this.logger.log(`Closed ${sessions} timed-out streaming session(s)`);
    return { sessions };
  }
}
