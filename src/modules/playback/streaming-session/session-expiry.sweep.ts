import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { StreamingEndReason, StreamingSessionStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { WatchProgressService } from '../watch-progress/watch-progress.service';

const BATCH = 200;

/**
 * Flow 3, step 21 for viewers who just close the app: ACTIVE sessions whose
 * heartbeat timed out are closed as EXPIRED, and the member's last position is
 * saved so nothing watched is lost. The device slot frees with the row.
 */
@Injectable()
export class SessionExpirySweep implements OnModuleInit {
  private readonly logger = new Logger(SessionExpirySweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
    private readonly progress: WatchProgressService,
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
    const { playbackHeartbeatTimeoutSeconds, episodeCompletionPercent } = await this.settings.get();
    const cutoff = new Date(now.getTime() - playbackHeartbeatTimeoutSeconds * 1000);
    let sessions = 0;
    for (;;) {
      const due = await this.prisma.streamingSession.findMany({
        where: { status: StreamingSessionStatus.ACTIVE, lastHeartbeatAt: { lte: cutoff } },
        orderBy: { lastHeartbeatAt: 'asc' },
        take: BATCH,
        include: { mediaAsset: { select: { durationSeconds: true } } },
      });
      if (!due.length) break;
      for (const session of due) {
        // A heartbeat may have landed while this batch waited: only the still-ACTIVE row closes.
        const { count } = await this.prisma.streamingSession.updateMany({
          where: { id: session.id, status: StreamingSessionStatus.ACTIVE },
          data: {
            status: StreamingSessionStatus.ENDED,
            endReason: StreamingEndReason.EXPIRED,
            endedAt: now,
          },
        });
        if (count === 0) continue;
        sessions += 1;
        if (session.userId) {
          const duration = session.mediaAsset.durationSeconds;
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
