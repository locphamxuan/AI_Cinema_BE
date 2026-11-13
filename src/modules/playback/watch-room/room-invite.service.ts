import { Injectable } from '@nestjs/common';
import { FriendshipService } from 'src/modules/episode-access/access-decision/friendship.service';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { INVITE_COOLDOWN_MS, INVITE_TTL_MS } from './room-events';

export interface RoomInvite {
  roomId: string;
  invitedBy: string;
  expiresAt: number;
}

export type InviteOutcome =
  | { ok: true; invite: RoomInvite; deliver: 'SOCKET' | 'NOTIFICATION' }
  | { ok: false; reason: 'COOLDOWN'; retryAfterSeconds: number }
  | { ok: false; reason: 'NOT_FRIENDS' };

/**
 * Edges 7.1–7.3 — a Host invites an accepted friend into the room: one invite per friend per room
 * per minute, each valid 10 minutes. An online friend gets it on their socket (the client asks
 * whether to leave a room they are already in); an offline one gets an in-app notification. A
 * blocked pair is never an accepted friendship, so a block also stops invites.
 */
@Injectable()
export class RoomInviteService {
  private readonly sentAt = new Map<string, number>();

  constructor(
    private readonly friendships: FriendshipService,
    private readonly notifications: NotificationService,
  ) {}

  async invite(
    userId: string,
    roomId: string,
    friendId: string,
    friendOnline: boolean,
    now = Date.now(),
  ): Promise<InviteOutcome> {
    const key = `${userId}|${friendId}|${roomId}`;
    const last = this.sentAt.get(key);
    if (last !== undefined && now - last < INVITE_COOLDOWN_MS) {
      return { ok: false, reason: 'COOLDOWN', retryAfterSeconds: Math.ceil((last + INVITE_COOLDOWN_MS - now) / 1000) };
    }
    const friends = await this.friendships.acceptedFriends(userId);
    if (!friends.some((f) => f.id === friendId)) return { ok: false, reason: 'NOT_FRIENDS' };

    this.sentAt.set(key, now);
    const invite = { roomId, invitedBy: userId, expiresAt: now + INVITE_TTL_MS };
    if (friendOnline) return { ok: true, invite, deliver: 'SOCKET' };
    await this.notifications.notify([friendId], {
      type: NOTIFICATION_TYPE.ROOM_INVITE,
      title: 'Bạn được mời xem phim cùng nhóm',
      body: 'Lời mời có hiệu lực trong 10 phút.',
      link: `/watch-rooms/${roomId}`,
      payload: { ...invite },
    });
    return { ok: true, invite, deliver: 'NOTIFICATION' };
  }
}
