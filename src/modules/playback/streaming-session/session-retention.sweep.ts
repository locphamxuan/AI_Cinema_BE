import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { StreamingEndReason, StreamingSessionStatus } from '@prisma/client';
import { businessDay } from 'src/common/time/business-day';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';

const BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The session columns the daily roll-up reads. */
const ROLLUP_COLUMNS = {
  id: true,
  episodeId: true,
  startedAt: true,
  totalWatchedSeconds: true,
  endReason: true,
} as const;

/**
 * The expiry sweep closes timed-out sessions but never deletes them, so without this job
 * streaming_sessions only grows — guest rows above all, and none of them serve anything
 * once viewing has moved on (resume history lives in watch_progress). Once a finished
 * session is `playback.sessionRetentionDays` old, its row is deleted; the session_ad_breaks
 * rows follow through ON DELETE CASCADE.
 *
 * Revenue sharing and analytics read watch time, so each page is first added to
 * episode_watch_stats (per episode and Vietnam day the session started) in the same
 * transaction that deletes it: a row is counted exactly once, never lost.
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
        select: ROLLUP_COLUMNS,
        take: BATCH,
      });
      if (!due.length) break;
      const count = await this.prisma.$transaction(async (tx) => {
        for (const stat of dailyStats(due)) {
          const { episodeId, statDate, sessions: opened, completedSessions, totalWatchedSeconds } = stat;
          await tx.episodeWatchStat.upsert({
            where: { episodeId_statDate: { episodeId, statDate } },
            create: stat,
            update: {
              sessions: { increment: opened },
              completedSessions: { increment: completedSessions },
              totalWatchedSeconds: { increment: totalWatchedSeconds },
            },
          });
        }
        const deleted = await tx.streamingSession.deleteMany({ where: { id: { in: due.map(({ id }) => id) } } });
        return deleted.count;
      });
      sessions += count;
      if (due.length < BATCH) break;
    }
    if (sessions) this.logger.log(`Deleted ${sessions} finished streaming session(s) past retention`);
    return { sessions };
  }
}

/** One page of finished sessions summed per (episode, Vietnam day the session started). */
export function dailyStats(
  rows: { episodeId: string; startedAt: Date; totalWatchedSeconds: number; endReason: StreamingEndReason | null }[],
) {
  const stats = new Map<
    string,
    { episodeId: string; statDate: Date; sessions: number; completedSessions: number; totalWatchedSeconds: bigint }
  >();
  for (const row of rows) {
    const statDate = businessDay(row.startedAt);
    const key = `${row.episodeId}:${statDate.toISOString()}`;
    const stat = stats.get(key) ?? {
      episodeId: row.episodeId,
      statDate,
      sessions: 0,
      completedSessions: 0,
      totalWatchedSeconds: 0n,
    };
    stat.sessions += 1;
    if (row.endReason === StreamingEndReason.COMPLETED) stat.completedSessions += 1;
    stat.totalWatchedSeconds += BigInt(row.totalWatchedSeconds);
    stats.set(key, stat);
  }
  return [...stats.values()];
}
