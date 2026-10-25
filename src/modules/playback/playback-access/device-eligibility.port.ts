import { ForbiddenException } from '@nestjs/common';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { RunningPlanSnapshot } from 'src/modules/episode-access/subscription/running-plan';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';

/** Fallback when the Admin left the member's plan without a stream limit. */
export const DEFAULT_MAX_CONCURRENT_STREAMS = 2;

/**
 * MF-4 owns device registration and the concurrent-stream limit. Playback only needs
 * one question — "may this member open one more stream right now?" — so MF-4 can
 * replace the default implementation below without touching the session flow.
 */
export abstract class DeviceEligibilityPort {
  /**
   * May this member open one more stream right now? `memberPlan` is the plan whose limits
   * apply — the running plan, else the Free plan every account starts on (BR-34) — as
   * create() already read it, so the check never re-reads it. `db` carries the creation
   * transaction so the count and the insert serialize (F-2).
   */
  abstract check(userId: string, memberPlan: RunningPlanSnapshot | null, db?: PrismaTx): Promise<void>;
}

/**
 * Phase-1 stand-in until MF-4: counts the member's live ACTIVE sessions against the plan's
 * `features.maxConcurrentStreams` as the Admin configured it (or the default). Stale sessions
 * whose heartbeat already timed out do not occupy a slot; the expiry sweep closes them.
 */
export class CountingDeviceEligibilityService extends DeviceEligibilityPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
  ) {
    super();
  }

  async check(userId: string, memberPlan: RunningPlanSnapshot | null, db?: PrismaTx): Promise<void> {
    const { playbackHeartbeatTimeoutSeconds } = await this.settings.get();
    const aliveSince = new Date(Date.now() - playbackHeartbeatTimeoutSeconds * 1000);
    const client: PrismaService | PrismaTx = db ?? this.prisma;
    const liveSessions = await client.streamingSession.count({
      where: { userId, status: 'ACTIVE', lastHeartbeatAt: { gt: aliveSince } },
    });
    const maxConcurrentStreams = maxConcurrentStreamsOf(memberPlan?.features) ?? DEFAULT_MAX_CONCURRENT_STREAMS;
    if (liveSessions >= maxConcurrentStreams) {
      throw new ForbiddenException({
        message: 'Too many concurrent streams for this plan',
        details: { reason: 'CONCURRENT_LIMIT_REACHED', maxConcurrentStreams, liveSessions },
      });
    }
  }
}

/**
 * Reads the concurrent-stream limit out of the free-form `plans.features` JSON (BR-34:
 * `maxConcurrentStreams`; plans saved before the split still carry it as `maxDevices`).
 * Anything that is not a positive integer — a missing key, a string, zero, a fraction — is
 * not a limit, so the caller can fall back to the default.
 */
export function maxConcurrentStreamsOf(features: unknown): number | null {
  if (!features || typeof features !== 'object') return null;
  const { maxConcurrentStreams, maxDevices } = features as { maxConcurrentStreams?: unknown; maxDevices?: unknown };
  const value = maxConcurrentStreams ?? maxDevices;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}
