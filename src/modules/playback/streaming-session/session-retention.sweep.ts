import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { StreamingSessionStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';

const BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The expiry sweep closes timed-out sessions but never deletes them, so without this job
 * streaming_sessions only grows — guest rows above all, and none of them serve anything
 * once viewing has moved on (resume history lives in watch_progress). Once a finished
 * session is `playback.sessionRetentionDays` old, its row is deleted; the session_ad_breaks
 * rows follow through ON DELETE CASCADE.
 */
@Injectable()
export class SessionRetentionSweep implements OnModuleInit {
  private readonly logger = new Logger(SessionRetentionSweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every(
      'streaming-session-retention.sweep',
      this.config.schedules.streamingSessionRetentionSweepMs,
      () => this.purgeDue().then(() => undefined),
    );
  }

  /** Deletes every finished session past the retention window; returns how many rows went. */
  async purgeDue(now = new Date()): Promise<{ sessions: number }> {
    const days = this.config.playback.sessionRetentionDays;
    if (days <= 0) return { sessions: 0 }; // 0 = keep every row forever.
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    let sessions = 0;
    for (;;) {
      const due = await this.prisma.streamingSession.findMany({
        where: {
          // An ACTIVE row is never deleted, however stale: the expiry sweep closes it
          // first, and only then does its retention clock (endedAt) start.
          status: { not: StreamingSessionStatus.ACTIVE },
          endedAt: { lte: cutoff },
        },
        orderBy: { endedAt: 'asc' },
        select: { id: true },
        take: BATCH,
      });
      if (!due.length) break;
      const { count } = await this.prisma.streamingSession.deleteMany({
        where: { id: { in: due.map(({ id }) => id) } },
      });
      sessions += count;
      if (due.length < BATCH) break;
    }
    if (sessions) this.logger.log(`Deleted ${sessions} finished streaming session(s) past retention`);
    return { sessions };
  }
}
