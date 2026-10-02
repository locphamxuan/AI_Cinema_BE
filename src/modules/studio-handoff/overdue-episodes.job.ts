import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { EpisodeStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { NotificationService } from 'src/modules/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/notification/notification-types';
import { DELIVERY_PROJECT_STATUSES } from 'src/modules/project-access/project-rules';

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
    const startOfToday = new Date(now.toISOString().slice(0, 10));
    const overdue = await this.prisma.episode.findMany({
      where: {
        status: EpisodeStatus.AWAITING_MEDIA,
        dueDate: { lt: startOfToday },
        movie: { status: { in: DELIVERY_PROJECT_STATUSES } },
      },
      include: { movie: { select: { id: true, title: true, reviewerId: true, creatorId: true } } },
    });

    let flagged = 0;
    for (const episode of overdue) {
      const alreadyFlagged = await this.prisma.notification.count({
        where: { type: NOTIFICATION_TYPE.EPISODE_OVERDUE, payload: { path: ['episodeId'], equals: episode.id } },
      });
      if (alreadyFlagged) continue;
      await this.notifications.notify([episode.movie.creatorId, episode.movie.reviewerId], {
        type: NOTIFICATION_TYPE.EPISODE_OVERDUE,
        title: `Episode ${episode.episodeNumber} of "${episode.movie.title}" is overdue`,
        body: `The studio was due to deliver it on ${episode.dueDate?.toISOString().slice(0, 10)}.`,
        link: `/projects/${episode.movie.id}`,
        payload: { movieId: episode.movie.id, episodeId: episode.id },
      });
      flagged += 1;
    }
    return flagged;
  }
}
