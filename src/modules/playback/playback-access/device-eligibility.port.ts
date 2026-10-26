import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { RunningPlanSnapshot } from 'src/modules/episode-access/subscription/running-plan';

/** Fallback when the Admin left the member's plan without a stream limit. */
export const DEFAULT_MAX_CONCURRENT_STREAMS = 2;
/** Fallback when the Admin left the member's plan without a device limit. */
export const DEFAULT_MAX_REGISTERED_DEVICES = 2;

/** The install the member plays on: the UUID v4 it keeps (X-Device-Id) and how it names itself. */
export interface DeviceIdentity {
  key: string;
  name?: string;
  platform?: string;
}

/**
 * MF-4 owns device registration and the concurrent-stream limit. Playback asks it two
 * questions before opening a member session: which registered device is this (registering it
 * while the plan has room), and may this member open one more stream right now.
 */
export abstract class DeviceEligibilityPort {
  /**
   * Registers the device, or refreshes it when already registered, and answers its id. A new
   * device past the plan's `maxRegisteredDevices` is refused with DEVICE_LIMIT_REACHED. It runs
   * outside the session transaction: a registered device stays even when the stream check then
   * fails (MF-4 §4.4.1).
   */
  abstract register(
    userId: string,
    device: DeviceIdentity | undefined,
    memberPlan: RunningPlanSnapshot | null,
  ): Promise<string>;

  /**
   * May this member open one more stream right now? `memberPlan` is the plan whose limits
   * apply — the running plan, else the Free plan every account starts on (BR-34) — as
   * create() already read it, so the check never re-reads it. `db` carries the creation
   * transaction so the count and the insert serialize (F-2). One device plays one stream: what
   * `deviceId` is still playing is stopped first, so switching episodes never hits the limit.
   */
  abstract check(
    userId: string,
    memberPlan: RunningPlanSnapshot | null,
    db?: PrismaTx,
    deviceId?: string | null,
  ): Promise<void>;
}

/** A positive integer out of free-form `plans.features`; anything else is not a limit. */
function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
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
  return positiveInteger(maxConcurrentStreams ?? maxDevices);
}

/** Reads `maxRegisteredDevices` (BR-34) the same way: null when the plan does not set a usable one. */
export function maxRegisteredDevicesOf(features: unknown): number | null {
  if (!features || typeof features !== 'object') return null;
  return positiveInteger((features as { maxRegisteredDevices?: unknown }).maxRegisteredDevices);
}

/** The two limits of the plan a member is on, with the defaults filled in. */
export function deviceLimitsOf(memberPlan: RunningPlanSnapshot | null) {
  return {
    maxRegisteredDevices: maxRegisteredDevicesOf(memberPlan?.features) ?? DEFAULT_MAX_REGISTERED_DEVICES,
    maxConcurrentStreams: maxConcurrentStreamsOf(memberPlan?.features) ?? DEFAULT_MAX_CONCURRENT_STREAMS,
  };
}
