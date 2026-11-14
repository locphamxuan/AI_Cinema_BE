import { Injectable, NotFoundException } from '@nestjs/common';
import { StreamingEndReason, StreamingSessionStatus, type StreamingSession } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { deviceLimitsOf } from '../playback-access/device-eligibility.port';
import { PlaybackAccessService } from '../playback-access/playback-access.service';
import { sessionEnded } from '../streaming-session/playback-events';

const LIVE_SESSION_VIEW = {
  id: true,
  deviceId: true,
  startedAt: true,
  lastHeartbeatAt: true,
  lastPositionSeconds: true,
  episode: { select: { id: true, title: true, episodeNumber: true, movie: { select: { title: true } } } },
} as const;

/**
 * MF-4 for the member managing their own devices: the registered devices and live streams
 * next to the limits of the plan they are on, removing a device and ending a stream elsewhere
 * to free a slot (BR-34). Ending a stream marks it KICKED; its player sees SESSION_NOT_ACTIVE
 * on the next heartbeat.
 */
@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
    private readonly access: PlaybackAccessService,
    private readonly audit: AuditLogService,
  ) {}

  /** `deviceKey` is the caller's X-Device-Id, so the list can say which device is this one. */
  async overview(userId: string, deviceKey?: string) {
    const memberPlan = (await this.access.runningPlanOf(userId)) ?? (await this.access.freePlanOf());
    const { playbackHeartbeatTimeoutSeconds } = await this.settings.get();
    const aliveSince = new Date(Date.now() - playbackHeartbeatTimeoutSeconds * 1000);
    const [devices, sessions] = await Promise.all([
      this.prisma.userDevice.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } }),
      this.prisma.streamingSession.findMany({
        where: { userId, status: StreamingSessionStatus.ACTIVE, lastHeartbeatAt: { gt: aliveSince } },
        orderBy: { startedAt: 'desc' },
        select: LIVE_SESSION_VIEW,
      }),
    ]);
    return {
      limits: deviceLimitsOf(memberPlan),
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        current: Boolean(deviceKey) && d.deviceKey === deviceKey,
      })),
      activeSessions: sessions.map((s) => ({
        id: s.id,
        deviceId: s.deviceId,
        startedAt: s.startedAt,
        lastHeartbeatAt: s.lastHeartbeatAt,
        positionSeconds: s.lastPositionSeconds,
        episode: {
          id: s.episode.id,
          title: s.episode.title,
          episodeNumber: s.episode.episodeNumber,
          movieTitle: s.episode.movie.title,
        },
      })),
    };
  }

  /** Removes the device and ends whatever it is still playing; it registers again on its next play. */
  async remove(userId: string, deviceId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const device = await tx.userDevice.findFirst({ where: { id: deviceId, userId }, select: { id: true } });
      if (!device) throw new NotFoundException('Device not found');
      const live = await tx.streamingSession.findMany({
        where: { deviceId, status: StreamingSessionStatus.ACTIVE },
      });
      await this.kick(live, tx);
      await tx.userDevice.delete({ where: { id: deviceId } });
    });
  }

  /** Ends one of the member's own live streams so another device can play (MF-4 §4.4.2). */
  async endSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.streamingSession.findFirst({
        where: { id: sessionId, userId, status: StreamingSessionStatus.ACTIVE },
      });
      if (!session) throw new NotFoundException('Streaming session not found');
      await this.kick([session], tx);
    });
  }

  private async kick(sessions: StreamingSession[], tx: PrismaTx) {
    if (!sessions.length) return;
    await tx.streamingSession.updateMany({
      where: { id: { in: sessions.map((s) => s.id) }, status: StreamingSessionStatus.ACTIVE },
      data: { status: StreamingSessionStatus.ENDED, endReason: StreamingEndReason.KICKED, endedAt: new Date() },
    });
    await this.audit.recordMany(
      sessions.map((s) => sessionEnded(s, StreamingEndReason.KICKED)),
      tx,
    );
  }
}
