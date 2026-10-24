import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdBreakStatus, AdStatus, StreamingSessionStatus, type Ad } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { runningPlanWhere } from 'src/modules/episode-access/subscription/running-plan';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { SessionCaller } from '../streaming-session/streaming-session.service';

/** No cue in the first or last minute: intros and credits stay clean. */
export const AD_EDGE_SECONDS = 60;

/**
 * How far the reported playhead may sit from the cue and still count (P4-2). The window
 * absorbs keyframe granularity and the player's trigger delay, not a whole scrubbed gap.
 */
export const AD_IMPRESSION_TOLERANCE_SECONDS = 30;

export interface AdScheduleItem {
  breakId: string;
  positionSeconds: number;
  ad: { id: string; title: string; mediaUrl: string; clickUrl: string | null; durationSeconds: number };
}

/**
 * Mid-roll cues (flow 3, steps 12–13, 16–17). Schedule and impression share one
 * SessionAdBreak row: SCHEDULED at session creation, PLAYED when the player
 * reaches the cue — which also counts the impression.
 */
@Injectable()
export class AdBreakService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
  ) {}

  /**
   * Step 13: lay up to adMaxBreaksPerEpisode cues evenly across the episode,
   * each holding a weighted draw among the currently valid ads. Ad-free plans
   * and episodes too short for a clean window get no cue at all.
   */
  async scheduleFor(
    sessionId: string,
    input: { userId?: string; durationSeconds: number | null },
  ): Promise<AdScheduleItem[]> {
    const [settings, adFree] = await Promise.all([this.settings.get(), this.adFreeOf(input.userId)]);
    if (adFree) return [];
    const duration = input.durationSeconds;
    if (!duration || duration <= AD_EDGE_SECONDS * 2) return [];
    const eligible = await this.prisma.ad.findMany({
      where: {
        status: AdStatus.ACTIVE,
        OR: [{ validFrom: null }, { validFrom: { lte: new Date() } }],
        AND: [{ OR: [{ validTo: null }, { validTo: { gt: new Date() } }] }],
      },
    });
    if (!eligible.length || settings.adMaxBreaksPerEpisode <= 0) return [];
    const count = Math.min(settings.adMaxBreaksPerEpisode, eligible.length);
    const positions = spreadPositions(duration, count);
    const picks = weightedOrder(eligible).slice(0, positions.length);
    // Fewer distinct ads than cues: cycle the order instead of inventing cues.
    const data = positions.map((positionSeconds, i) => ({
      streamingSessionId: sessionId,
      adId: picks[i % picks.length].id,
      positionSeconds,
    }));
    // P4-1: one INSERT is atomic, so a mid-way failure can never leave half a schedule.
    // skipDuplicates makes a concurrent double-schedule reuse the cues already laid
    // instead of answering the whole POST /sessions with a unique-constraint 500.
    await this.prisma.sessionAdBreak.createMany({ data, skipDuplicates: true });
    return this.scheduleOf(sessionId);
  }

  /** Cues already laid for a session, e.g. when a double tap reuses it. */
  async scheduleOf(sessionId: string): Promise<AdScheduleItem[]> {
    const rows = await this.prisma.sessionAdBreak.findMany({
      where: { streamingSessionId: sessionId },
      orderBy: { positionSeconds: 'asc' },
      include: { ad: true },
    });
    return rows.map(scheduleItem);
  }

  /**
   * Step 17: pause the episode content, play the cue, count the impression. Idempotent.
   *
   * P4-2: an impression is money, so it only counts when the player reports a playhead
   * inside AD_IMPRESSION_TOLERANCE_SECONDS of the cue. A player that calls `played` for
   * every cue when the movie opens now gets AD_BREAK_NOT_REACHED instead of billing every
   * advertiser. Product decision for a forward seek over a cue: the ad was never started,
   * so it is neither shown nor billed and no impression exists. The row deliberately stays
   * SCHEDULED (an untrusted out-of-window call is not proof of intent): if the viewer seeks
   * back and genuinely reaches the cue, it can still play — and count — once.
   *
   * The playhead is still client-reported: this is a bar against buggy or casual callers,
   * not cryptographic proof of playback; segment-level verification is the stronger follow-up.
   */
  async markPlayed(sessionId: string, breakId: string, caller: SessionCaller, input: { positionSeconds: number }) {
    const row = await this.prisma.sessionAdBreak.findUnique({
      where: { id: breakId },
      include: { session: true },
    });
    if (!row || row.streamingSessionId !== sessionId) {
      throw new NotFoundException({
        message: 'Ad break not found',
        details: { reason: 'AD_BREAK_NOT_FOUND' },
      });
    }
    const mine = row.session.userId
      ? Boolean(caller.userId) && row.session.userId === caller.userId
      : Boolean(caller.guestKey) && row.session.guestKey === caller.guestKey;
    if (!mine) {
      throw new ForbiddenException({
        message: 'This session belongs to someone else',
        details: { reason: 'SESSION_NOT_OWNER' },
      });
    }
    if (row.session.status !== StreamingSessionStatus.ACTIVE) {
      throw new ForbiddenException({
        message: 'The streaming session is no longer active',
        details: { reason: 'SESSION_NOT_ACTIVE' },
      });
    }
    if (row.status === AdBreakStatus.PLAYED) {
      return { breakId: row.id, status: row.status, playedAt: row.playedAt };
    }
    const distance = Math.abs(input.positionSeconds - row.positionSeconds);
    if (distance > AD_IMPRESSION_TOLERANCE_SECONDS) {
      const early = input.positionSeconds < row.positionSeconds;
      throw new ConflictException({
        message: early
          ? 'The player has not reached this ad break yet'
          : 'The player moved past this ad break without playing it; no impression is counted',
        details: {
          reason: early ? 'AD_BREAK_NOT_REACHED' : 'AD_BREAK_MISSED',
          cuePositionSeconds: row.positionSeconds,
          positionSeconds: input.positionSeconds,
          toleranceSeconds: AD_IMPRESSION_TOLERANCE_SECONDS,
        },
      });
    }
    const played = await this.prisma.sessionAdBreak.update({
      where: { id: row.id },
      data: { status: AdBreakStatus.PLAYED, playedAt: new Date(), completedView: true },
    });
    return { breakId: played.id, status: played.status, playedAt: played.playedAt };
  }

  private async adFreeOf(userId: string | undefined): Promise<boolean> {
    if (!userId) return false;
    const plan = await this.prisma.subscription.findFirst({
      where: runningPlanWhere(userId),
      orderBy: { currentPeriodEnd: 'desc' },
      include: { plan: { select: { features: true } } },
    });
    return (plan?.plan.features as { adFree?: unknown } | null)?.adFree === true;
  }
}

/** Evenly spaced cue points inside (edge, duration - edge); nudged apart on rounding collisions. */
export function spreadPositions(durationSeconds: number, count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new BadRequestException({
      message: 'The break count must be a positive integer',
      details: { reason: 'AD_BREAK_COUNT_INVALID' },
    });
  }
  const used = new Set<number>();
  return Array.from({ length: count }, (_, i) => {
    let position = Math.round(AD_EDGE_SECONDS + ((durationSeconds - AD_EDGE_SECONDS * 2) * (i + 1)) / (count + 1));
    while (used.has(position)) position += 1;
    used.add(position);
    return position;
  });
}

/** Eligible ads shuffled by weight (heavier first on average), without replacement. */
export function weightedOrder<T extends Pick<Ad, 'weight'>>(ads: T[]): T[] {
  const remaining = [...ads];
  const ordered: T[] = [];
  while (remaining.length) {
    const total = remaining.reduce((sum, ad) => sum + Math.max(ad.weight, 1), 0);
    let draw = Math.random() * total;
    const index = remaining.findIndex((ad) => (draw -= Math.max(ad.weight, 1)) < 0);
    ordered.push(...remaining.splice(index === -1 ? remaining.length - 1 : index, 1));
  }
  return ordered;
}

function scheduleItem(row: { id: string; positionSeconds: number; ad: Ad }): AdScheduleItem {
  return {
    breakId: row.id,
    positionSeconds: row.positionSeconds,
    ad: {
      id: row.ad.id,
      title: row.ad.title,
      mediaUrl: row.ad.mediaUrl,
      clickUrl: row.ad.clickUrl,
      durationSeconds: row.ad.durationSeconds,
    },
  };
}
