import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectStatus, PriceAlertStatus } from '@prisma/client';
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
import { liftProject, WITH_PROJECT } from 'src/modules/production/project-access/project-relations';

const UNRESOLVED: PriceAlertStatus[] = [PriceAlertStatus.OPEN, PriceAlertStatus.CHANGE_REQUESTED];

/**
 * MF-1 steps 12–13 (2026-11-11): the Admin alone prices each episode and flags which ones are
 * free before publishing (BR-29, BR-03/BR-19); the Reviewer stops at the Final Film. A price
 * outside the platform range is saved anyway and raises a price alert as a validation warning on
 * the Admin portal (BR-47). A free-for-Guest episode is always free for Members too.
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
    const episode = await this.access.episode(episodeId, user, 'read');
    assertProjectStatus(
      episode.project.status,
      [...OPEN_PROJECT_STATUSES, ProjectStatus.COMPLETED, ProjectStatus.UNDER_REVISION],
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
          projectId: episode.movieId,
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

  /**
   * BR-03/BR-19 — before publishing, the Admin says which episodes are open: free for Guests,
   * free for Members, or paid. A free-for-Guest episode is free for Members too (the inheritance
   * rule), so `isFreeForMember` is raised along with `isFreeForGuest` and can never sit below it.
   */
  async setAccessFlags(
    episodeId: string,
    flags: { isFreeForGuest?: boolean; isFreeForMember?: boolean },
    user: AuthenticatedUser,
  ) {
    const episode = await this.access.episode(episodeId, user, 'read');
    assertProjectStatus(
      episode.project.status,
      [...OPEN_PROJECT_STATUSES, ProjectStatus.COMPLETED, ProjectStatus.UNDER_REVISION],
      'flag an episode',
    );
    const isFreeForGuest = flags.isFreeForGuest ?? episode.isFreeForGuest;
    const isFreeForMember = isFreeForGuest || (flags.isFreeForMember ?? episode.isFreeForMember);
    await this.prisma.$transaction(async (tx) => {
      await tx.episode.update({ where: { id: episodeId }, data: { isFreeForGuest, isFreeForMember } });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.EPISODE_FLAGS_SET,
          entityType: 'Episode',
          entityId: episodeId,
          projectId: episode.movieId,
          actorId: user.id,
          payload: {
            previous: { isFreeForGuest: episode.isFreeForGuest, isFreeForMember: episode.isFreeForMember },
            isFreeForGuest,
            isFreeForMember,
          },
        },
        tx,
      );
    });
    return { episodeId, isFreeForGuest, isFreeForMember };
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
    const { movie, project } = alert.episode;
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
        [project.reviewerId],
        {
          type: NOTIFICATION_TYPE.PRICE_CHANGE_REQUEST,
          title: `Admin đề nghị xem lại giá tập ${alert.episode.episodeNumber} của phim "${movie.title}"`,
          body: note.trim(),
          link: `/projects/${movie.id}/episodes/${alert.episodeId}`,
          payload: { projectId: movie.id, episodeId: alert.episodeId, priceAlertId: alertId },
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
        projectId: episode.movieId,
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
        payload: { projectId: episode.movieId, episodeId: episode.id, priceAlertId: alert.id },
      },
      tx,
    );
    return alert;
  }

  private async findAlert(alertId: string) {
    const alert = await this.prisma.priceAlert.findUnique({
      where: { id: alertId },
      include: { episode: { include: WITH_PROJECT } },
    });
    if (!alert) throw new NotFoundException('Price alert not found');
    return { ...alert, episode: liftProject(alert.episode) };
  }
}
