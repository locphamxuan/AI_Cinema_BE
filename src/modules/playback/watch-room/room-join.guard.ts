import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FriendshipStatus, StreamingSessionStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WatchEntitlementService } from 'src/modules/episode-access/access-decision/watch-entitlement.service';
import { isAdult } from 'src/modules/identity/auth/credentials';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { PlaybackAccessService } from '../playback-access/playback-access.service';
import { deviceLimitsOf } from '../playback-access/device-eligibility.port';
import { ROOM_CAPACITY } from './room-events';

/** Movie labels only confirmed adults may watch (edge 6.2, Điều 44 Luật Điện ảnh 134/2025/QH15). */
const ADULT_LABELS = new Set(['T18']);

/**
 * The paywall gate of a watch room (edges 1.1, 4.2, 5.1, 6.2, 7.3): every member is checked at the
 * door, before a participant row exists — entitlement first (no ride-along on the Host's stream),
 * then the age label, the room capacity, the MF-4 concurrent-device cap, and blocks between the
 * joiner and the Host. Each refusal carries a `reason` the clients map to their own bottom sheets.
 */
@Injectable()
export class RoomJoinGuard {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlement: WatchEntitlementService,
    private readonly playbackAccess: PlaybackAccessService,
    private readonly settings: PlatformSettingService,
  ) {}

  /** Every check a member must pass before entering the room of this episode. */
  async assertMayJoin(
    userId: string,
    episodeId: string,
    room?: { hostUserId: string | null; participants: { userId: string; leftAt: Date | null }[] },
  ): Promise<void> {
    await this.assertEntitled(userId, episodeId);
    await this.assertOldEnough(userId, episodeId);
    if (room) {
      this.assertCapacity(room.participants, userId);
      await this.assertNotBlocked(userId, room.hostUserId);
    }
    await this.assertDeviceSlotFree(userId);
  }

  /**
   * Edge 1.1 — the Paywall Gate: a member without their own right to the episode is refused with
   * the same `required` payload MF-2 answers, so the client can offer "Mở khóa bằng Coin" or
   * "Nâng cấp Hội viên" and re-join after paying.
   */
  private async assertEntitled(userId: string, episodeId: string): Promise<void> {
    const check = await this.entitlement.canWatch(episodeId, userId);
    if (check.allowed) return;
    throw new ForbiddenException({
      message: 'Tập này cần mở khóa bằng Coin hoặc Gói Hội viên để xem cùng nhóm',
      details: { reason: 'ENTITLEMENT_REQUIRED', nextAction: check.reason, required: check.required },
    });
  }

  /** Edge 6.2 — the age gate refusal: a T18 episode never admits an unconfirmed account. */
  private async assertOldEnough(userId: string, episodeId: string): Promise<void> {
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      select: { movie: { select: { ageRating: true } } },
    });
    if (!episode || !ADULT_LABELS.has(episode.movie.ageRating ?? '')) return;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } });
    if (user?.dateOfBirth && isAdult(user.dateOfBirth)) return;
    throw new ForbiddenException({
      message: 'Tập phim này dành cho khán giả từ 18 tuổi trở lên. Tài khoản của bạn chưa đủ điều kiện tham gia',
      details: { reason: 'AGE_RESTRICTED', ageRating: 'T18' },
    });
  }

  /** Edge 4.2 — the room capacity cap; a member already in the room may always come back. */
  private assertCapacity(participants: { userId: string; leftAt: Date | null }[], userId: string): void {
    const active = participants.filter((p) => !p.leftAt);
    if (active.some((p) => p.userId === userId)) return;
    if (active.length >= ROOM_CAPACITY) {
      throw new ConflictException({
        message: 'Phòng đã đủ số lượng thành viên tối đa',
        details: { reason: 'ROOM_FULL', capacity: ROOM_CAPACITY },
      });
    }
  }

  /** Edge 7.3 — a block in either direction hides the room as if it never existed. */
  private async assertNotBlocked(userId: string, hostUserId: string | null): Promise<void> {
    if (!hostUserId || hostUserId === userId) return;
    const blocked = await this.prisma.friendship.count({
      where: {
        status: FriendshipStatus.BLOCKED,
        OR: [
          { senderId: userId, receiverId: hostUserId },
          { senderId: hostUserId, receiverId: userId },
        ],
      },
    });
    if (blocked > 0) {
      throw new NotFoundException({ message: 'Room not found', details: { reason: 'ROOM_NOT_FOUND' } });
    }
  }

  /**
   * Edge 5.1 — MF-4 before the ticket: a member already at their plan's concurrent-stream cap is
   * refused with 409 DEVICE_LIMIT_EXCEEDED and the devices still playing, so the client can offer
   * a remote sign-out instead of a dead end.
   */
  private async assertDeviceSlotFree(userId: string): Promise<void> {
    const plan = (await this.playbackAccess.runningPlanOf(userId)) ?? (await this.playbackAccess.freePlanOf());
    const { maxConcurrentStreams } = deviceLimitsOf(plan);
    const { playbackHeartbeatTimeoutSeconds } = await this.settings.get();
    const aliveSince = new Date(Date.now() - playbackHeartbeatTimeoutSeconds * 1000);
    const live = await this.prisma.streamingSession.findMany({
      where: { userId, status: StreamingSessionStatus.ACTIVE, lastHeartbeatAt: { gt: aliveSince } },
      select: { deviceId: true, device: { select: { id: true, name: true, platform: true } } },
    });
    if (live.length < maxConcurrentStreams) return;
    throw new ConflictException({
      message: 'Tài khoản đã đạt số thiết bị phát đồng thời tối đa',
      details: {
        reason: 'DEVICE_LIMIT_EXCEEDED',
        maxConcurrentStreams,
        devices: live.map((s) => s.device ?? { id: s.deviceId, name: null, platform: null }),
      },
    });
  }
}
