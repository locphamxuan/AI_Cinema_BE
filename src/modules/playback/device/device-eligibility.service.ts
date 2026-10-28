import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { StreamingEndReason, StreamingSessionStatus } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { RunningPlanSnapshot } from 'src/modules/episode-access/subscription/running-plan';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { DeviceEligibilityPort, deviceLimitsOf, type DeviceIdentity } from '../playback-access/device-eligibility.port';
import { sessionEnded } from '../streaming-session/playback-events';
import { WatchProgressService } from '../watch-progress/watch-progress.service';

const PLATFORMS = new Set(['IOS', 'ANDROID', 'WEB']);
const UNNAMED_DEVICE = 'Thiết bị chưa đặt tên';

/** How the device list shows the platform: one of the known ones, else OTHER. */
export function platformOf(raw: string | undefined): string {
  const platform = raw?.trim().toUpperCase() ?? '';
  return PLATFORMS.has(platform) ? platform : 'OTHER';
}

/**
 * MF-4 for a member opening a stream: registers the device against the plan's
 * `maxRegisteredDevices`, then counts live sessions against `maxConcurrentStreams` (BR-34).
 * A session whose heartbeat already timed out does not occupy a slot; the expiry sweep closes it.
 */
@Injectable()
export class DeviceEligibilityService extends DeviceEligibilityPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
    private readonly audit: AuditLogService,
    private readonly progress: WatchProgressService,
  ) {
    super();
  }

  async register(
    userId: string,
    device: DeviceIdentity | undefined,
    memberPlan: RunningPlanSnapshot | null,
  ): Promise<string> {
    if (!device?.key || !isUUID(device.key, 4)) {
      throw new BadRequestException({
        message: 'Members must send X-Device-Id as a UUID v4',
        details: { reason: 'DEVICE_ID_REQUIRED' },
      });
    }
    const name = device.name?.trim().slice(0, 120) || undefined;
    const platform = platformOf(device.platform);
    // Two first plays from new devices must not both slip under the limit.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'devices:' + userId}))`;
      const known = await tx.userDevice.findUnique({ where: { userId_deviceKey: { userId, deviceKey: device.key } } });
      if (known) {
        await tx.userDevice.update({
          where: { id: known.id },
          data: { lastSeenAt: new Date(), platform, ...(name ? { name } : {}) },
        });
        return known.id;
      }
      const { maxRegisteredDevices } = deviceLimitsOf(memberPlan);
      const registeredDevices = await tx.userDevice.count({ where: { userId } });
      if (registeredDevices >= maxRegisteredDevices) {
        throw new ForbiddenException({
          message: 'Too many registered devices for this plan',
          details: { reason: 'DEVICE_LIMIT_REACHED', maxRegisteredDevices, registeredDevices },
        });
      }
      const created = await tx.userDevice.create({
        data: { userId, deviceKey: device.key, name: name ?? UNNAMED_DEVICE, platform },
      });
      return created.id;
    });
  }

  async check(
    userId: string,
    memberPlan: RunningPlanSnapshot | null,
    db?: PrismaTx,
    deviceId?: string | null,
  ): Promise<void> {
    const client: PrismaService | PrismaTx = db ?? this.prisma;
    if (deviceId) await this.stopWhatDevicePlays(userId, deviceId, client);
    const { playbackHeartbeatTimeoutSeconds } = await this.settings.get();
    const aliveSince = new Date(Date.now() - playbackHeartbeatTimeoutSeconds * 1000);
    const liveSessions = await client.streamingSession.count({
      where: { userId, status: StreamingSessionStatus.ACTIVE, lastHeartbeatAt: { gt: aliveSince } },
    });
    const { maxConcurrentStreams } = deviceLimitsOf(memberPlan);
    if (liveSessions >= maxConcurrentStreams) {
      throw new ForbiddenException({
        message: 'Too many concurrent streams for this plan',
        details: { reason: 'CONCURRENT_LIMIT_REACHED', maxConcurrentStreams, liveSessions },
      });
    }
  }

  /**
   * The device moved on to another episode: the stream it was playing ends as STOPPED, its last
   * beat saved as the resume point in case the player's own stop has not landed yet.
   */
  private async stopWhatDevicePlays(userId: string, deviceId: string, client: PrismaService | PrismaTx) {
    const playing = await client.streamingSession.findMany({
      where: { userId, deviceId, status: StreamingSessionStatus.ACTIVE },
    });
    if (!playing.length) return;
    await client.streamingSession.updateMany({
      where: { id: { in: playing.map((s) => s.id) }, status: StreamingSessionStatus.ACTIVE },
      data: { status: StreamingSessionStatus.ENDED, endReason: StreamingEndReason.STOPPED, endedAt: new Date() },
    });
    await this.audit.recordMany(
      playing.map((s) => sessionEnded(s, StreamingEndReason.STOPPED)),
      client,
    );
    const at = new Date();
    // On the same client as the stop: a new session refused by the limit rolls these back too.
    for (const s of playing) {
      await this.progress.saveStopPoint(client, userId, s.episodeId, {
        positionSeconds: s.lastPositionSeconds,
        durationSeconds: s.durationSeconds,
        at,
      });
    }
  }
}
