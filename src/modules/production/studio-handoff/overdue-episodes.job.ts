import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { EpisodeStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { businessDay } from 'src/common/time/business-day';

/**
 * BR-38: an episode past its due date without a delivery is flagged once, to its Creator and
 * Reviewer. The dashboard reads overdue episodes straight from due_date and status.
 */
@Injectable()
export class OverdueEpisodesJob implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    private readonly notifications: NotificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every('episodes.overdue', this.config.schedules.overdueSweepMs, () =>
      this.sweep().then(() => undefined),
    );
  }

  /** Notifies about every newly overdue episode; returns how many were flagged. */
  async sweep(now = new Date()): Promise<number> {
    const startOfToday = businessDay(now);
    const overdue = await this.prisma.episode.findMany({
      where: {
        status: EpisodeStatus.AWAITING_MEDIA,
        dueDate: { lt: startOfToday },
        movie: { project: { status: { in: DELIVERY_PROJECT_STATUSES } } },
      },
      include: { movie: { select: { title: true, project: { select: { reviewerId: true, creatorId: true } } } } },
    });

    let flagged = 0;
    for (const episode of overdue) {
      const alreadyFlagged = await this.prisma.notification.count({
        where: { type: NOTIFICATION_TYPE.EPISODE_OVERDUE, payload: { path: ['episodeId'], equals: episode.id } },
      });
      if (alreadyFlagged) continue;
      await this.notifications.notify([episode.movie.project?.creatorId, episode.movie.project?.reviewerId], {
        type: NOTIFICATION_TYPE.EPISODE_OVERDUE,
        title: `Tập ${episode.episodeNumber} của phim "${episode.movie.title}" đã trễ hạn`,
        body: `Studio phải giao tập này trước ngày ${episode.dueDate?.toISOString().slice(0, 10)}.`,
        link: `/projects/${episode.movieId}`,
        payload: { projectId: episode.movieId, episodeId: episode.id },
      });
      flagged += 1;
    }
    return flagged;
  }
}
