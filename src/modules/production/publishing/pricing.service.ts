import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MovieStatus, PriceAlertStatus } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';

const UNRESOLVED: PriceAlertStatus[] = [PriceAlertStatus.OPEN, PriceAlertStatus.CHANGE_REQUESTED];

/**
 * MF-1 steps 12–13: the Reviewer prices each episode (BR-29). A price outside the Admin's range
 * is saved anyway and raises a price alert for the Admin, who can only ask for a change (BR-47).
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly settings: PlatformSettingService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  async setPrice(episodeId: string, coinPrice: number, user: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, user, 'reviewer');
    assertProjectStatus(
      episode.movie.status,
      [...OPEN_PROJECT_STATUSES, MovieStatus.COMPLETED, MovieStatus.UNDER_REVISION],
      'price an episode',
    );
    const { episodeCoinPriceMin: rangeMin, episodeCoinPriceMax: rangeMax } = await this.settings.get();
    const inRange = coinPrice >= rangeMin && coinPrice <= rangeMax;

    const alert = await this.prisma.$transaction(async (tx) => {
      await tx.episode.update({ where: { id: episodeId }, data: { coinPrice } });
      // A new price settles the alerts about the previous one.
      await tx.priceAlert.updateMany({
        where: { episodeId, status: { in: UNRESOLVED } },
        data: { status: PriceAlertStatus.RESOLVED, handledAt: new Date() },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.EPISODE_PRICED,
          entityType: 'Episode',
          entityId: episodeId,
          movieId: episode.movieId,
          actorId: user.id,
          payload: { previousPrice: episode.coinPrice, coinPrice, rangeMin, rangeMax },
        },
        tx,
      );
      if (inRange) return null;
      return this.raiseAlert(tx, { ...episode, coinPrice }, rangeMin, rangeMax, user.id);
    });
    return { episodeId, coinPrice, inRange, rangeMin, rangeMax, alert };
  }

  /** Price alerts for the Admin dashboard, open ones first by default. */
  listAlerts(query: PaginateQuery) {
    return paginate(query, this.prisma.priceAlert, {
      relations: {
        episode: {
          select: {
            id: true,
            episodeNumber: true,
            title: true,
            coinPrice: true,
            movie: { select: { id: true, title: true } },
          },
        },
        setBy: { select: { id: true, fullName: true } },
        handledBy: { select: { id: true, fullName: true } },
      },
      sortableColumns: ['createdAt', 'status'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { status: ['$eq', '$in'] },
    });
  }

  /** The Admin asks the Reviewer to reconsider the price; it stays as it is until they do. */
  async requestChange(alertId: string, note: string, admin: AuthenticatedUser) {
    const alert = await this.findAlert(alertId);
    if (alert.status !== PriceAlertStatus.OPEN) throw new ConflictException(`The alert is already ${alert.status}`);
    const { movie } = alert.episode;
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.priceAlert.updateMany({
        where: { id: alertId, status: PriceAlertStatus.OPEN },
        data: {
          status: PriceAlertStatus.CHANGE_REQUESTED,
          adminNote: note.trim(),
          handledById: admin.id,
          handledAt: new Date(),
        },
      });
      if (count === 0) throw new ConflictException('The alert changed meanwhile; reload it');
      await this.notifications.notify(
        [movie.reviewerId],
        {
          type: NOTIFICATION_TYPE.PRICE_CHANGE_REQUEST,
          title: `Admin đề nghị xem lại giá tập ${alert.episode.episodeNumber} của phim "${movie.title}"`,
          body: note.trim(),
          link: `/projects/${movie.id}/episodes/${alert.episodeId}`,
          payload: { movieId: movie.id, episodeId: alert.episodeId, priceAlertId: alertId },
        },
        tx,
      );
      return tx.priceAlert.findUniqueOrThrow({ where: { id: alertId } });
    });
  }

  /** The Admin accepts the out-of-range price as it is. */
  async resolve(alertId: string, admin: AuthenticatedUser) {
    const alert = await this.findAlert(alertId);
    if (!UNRESOLVED.includes(alert.status)) throw new ConflictException('The alert is already resolved');
    const { count } = await this.prisma.priceAlert.updateMany({
      where: { id: alertId, status: { in: UNRESOLVED } },
      data: { status: PriceAlertStatus.RESOLVED, handledById: admin.id, handledAt: new Date() },
    });
    if (count === 0) throw new ConflictException('The alert changed meanwhile; reload it');
    return this.prisma.priceAlert.findUniqueOrThrow({ where: { id: alertId } });
  }

  private async raiseAlert(
    tx: PrismaTx,
    episode: { id: string; episodeNumber: number; movieId: string; coinPrice: number; movie: { title: string } },
    rangeMin: number,
    rangeMax: number,
    reviewerId: string,
  ) {
    const alert = await tx.priceAlert.create({
      data: { episodeId: episode.id, coinPrice: episode.coinPrice, rangeMin, rangeMax, setById: reviewerId },
    });
    await this.auditLog.record(
      {
        action: CONTENT_EVENT.PRICE_OUT_OF_RANGE,
        entityType: 'PriceAlert',
        entityId: alert.id,
        movieId: episode.movieId,
        actorId: reviewerId,
        payload: { episodeId: episode.id, coinPrice: episode.coinPrice, rangeMin, rangeMax },
      },
      tx,
    );
    await this.notifications.notify(
      await this.notifications.adminIds(tx),
      {
        type: NOTIFICATION_TYPE.PRICE_OUT_OF_RANGE,
        title: `Giá tập ${episode.episodeNumber} của phim "${episode.movie.title}" nằm ngoài khoảng cho phép`,
        body: `${episode.coinPrice} Coin, khoảng cho phép ${rangeMin}–${rangeMax} Coin.`,
        link: `/admin/price-alerts`,
        payload: { movieId: episode.movieId, episodeId: episode.id, priceAlertId: alert.id },
      },
      tx,
    );
    return alert;
  }

  private async findAlert(alertId: string) {
    const alert = await this.prisma.priceAlert.findUnique({
      where: { id: alertId },
      include: { episode: { include: { movie: true } } },
    });
    if (!alert) throw new NotFoundException('Price alert not found');
    return alert;
  }
}
