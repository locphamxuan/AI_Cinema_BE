import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { currentActorId } from 'src/common/http/request-actor';
import { MF1_NOTIFICATION_TYPES, type NotificationType } from './notification-types';

export interface NotificationContent {
  type: NotificationType;
  title: string;
  body?: string;
  /** Portal or app screen the notification opens. */
  link?: string;
  payload?: Record<string, unknown>;
}

/** Column sizes of `notifications`: a long movie title must never make the change it reports fail. */
const TITLE_MAX = 255;
const LINK_MAX = 500;

/** Cuts a text to `max` characters, marking the cut with an ellipsis. */
function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** In-app notifications: every internal alert of the platform goes here, never by email (BR-53). */
@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sends the same notification to each recipient; pass `tx` to commit it with the change it reports. */
  async notify(userIds: (string | null | undefined)[], content: NotificationContent, tx?: PrismaTx): Promise<void> {
    const admins = MF1_NOTIFICATION_TYPES.has(content.type) ? await this.overseers(tx) : [];
    const recipients = [...new Set([...userIds, ...admins].filter((id): id is string => Boolean(id)))];
    if (!recipients.length) return;
    const persist = async (client: PrismaTx) => {
      await client.notification.createMany({
        data: recipients.map((userId) => ({
          userId,
          type: content.type,
          title: fit(content.title, TITLE_MAX),
          body: content.body,
          // A link too long for its column is dropped: a cut link would open the wrong screen.
          link: content.link && content.link.length <= LINK_MAX ? content.link : undefined,
          payload: content.payload as Prisma.InputJsonValue | undefined,
        })),
      });
      await client.notificationRealtimeEvent.createMany({
        data: recipients.map((userId) => ({ userId })),
      });
    };
    if (tx) await persist(tx);
    else await this.prisma.$transaction(persist);
  }

  /** The Admins who follow every movie project, without the one who just acted. */
  private async overseers(tx?: PrismaTx): Promise<string[]> {
    const actor = currentActorId();
    return (await this.adminIds(tx)).filter((id) => id !== actor);
  }

  /** Active Admin accounts, the audience of platform-level alerts. */
  async adminIds(tx?: PrismaTx): Promise<string[]> {
    const admins = await (tx ?? this.prisma).user.findMany({
      where: { role: UserRole.ADMIN, isActive: true },
      select: { id: true },
    });
    return admins.map(({ id }) => id);
  }

  /** Active accounts of a partner studio (MF-1, 07/11/2026): who hears about its contracts and films. */
  async studioAccountIds(studioId: string | null | undefined, tx?: PrismaTx): Promise<string[]> {
    if (!studioId) return [];
    const accounts = await (tx ?? this.prisma).user.findMany({
      where: { role: UserRole.STUDIO, studioId, isActive: true },
      select: { id: true },
    });
    return accounts.map(({ id }) => id);
  }

  findMine(userId: string, query: PaginateQuery) {
    return paginate(query, this.prisma.notification, {
      where: { userId },
      sortableColumns: ['createdAt'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { type: ['$eq', '$in'], readAt: ['$null'] },
    });
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  async markRead(userId: string, notificationId: string) {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.notification.updateMany({
        where: { id: notificationId, userId, readAt: null },
        data: { readAt: new Date() },
      });
      if (count === 0) {
        if (!(await tx.notification.count({ where: { id: notificationId, userId } }))) {
          throw new NotFoundException('Notification not found');
        }
        return;
      }
      await tx.notificationRealtimeEvent.create({ data: { userId } });
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      });
      if (count > 0) await tx.notificationRealtimeEvent.create({ data: { userId } });
      return { updated: count };
    });
  }
}
