import { ForbiddenException } from '@nestjs/common';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { RunningPlanSnapshot } from 'src/modules/episode-access/subscription/running-plan';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';

/** Fallback when neither the plan nor the episode carries a device limit. */
export const DEFAULT_MAX_DEVICES = 2;

/**
 * MF-4 owns device registration and the concurrent-stream limit. Playback only needs
 * one question — "may this member open one more stream right now?" — so MF-4 can
 * replace the default implementation below without touching the session flow.
 */
export abstract class DeviceEligibilityPort {
  /**
   * May this member open one more stream right now? `runningPlan` is the snapshot
   * create() already read (P4-5), so the check never re-reads the subscription;
   * `null` is a known "no plan". `db` carries the creation transaction so the count
   * and the insert serialize (F-2).
   */
  abstract check(userId: string, runningPlan: RunningPlanSnapshot | null, db?: PrismaTx): Promise<void>;
}

/**
 * Phase-1 stand-in: counts the member's live ACTIVE sessions against the running
 * plan's `features.maxDevices` (or the default). Stale sessions whose heartbeat
 * already timed out do not occupy a slot; the expiry sweep (a later phase) closes them.
 */
export class CountingDeviceEligibilityService extends DeviceEligibilityPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
  ) {
    super();
  }

  async check(userId: string, runningPlan: RunningPlanSnapshot | null, db?: PrismaTx): Promise<void> {
    const { playbackHeartbeatTimeoutSeconds } = await this.settings.get();
    const aliveSince = new Date(Date.now() - playbackHeartbeatTimeoutSeconds * 1000);
    const client: PrismaService | PrismaTx = db ?? this.prisma;
    const liveSessions = await client.streamingSession.count({
      where: { userId, status: 'ACTIVE', lastHeartbeatAt: { gt: aliveSince } },
    });
    const maxDevices = maxDevicesOf(runningPlan?.features) ?? DEFAULT_MAX_DEVICES;
    if (liveSessions >= maxDevices) {
      throw new ForbiddenException({
        message: 'Too many concurrent streams for this plan',
        details: { reason: 'CONCURRENT_LIMIT_REACHED', maxDevices, liveSessions },
      });
    }
  }
}

/**
 * Reads the device limit out of the free-form `plans.features` JSON. Anything that is not
 * a positive integer — a missing key, a string, zero, a fraction — is not a limit, so the
 * caller can fall back to the default.
 */
export function maxDevicesOf(features: unknown): number | null {
  if (!features || typeof features !== 'object') return null;
  const value = (features as { maxDevices?: unknown }).maxDevices;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}
