import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdBreakStatus, AdStatus, type Ad } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { RunningPlanSnapshot } from 'src/modules/episode-access/subscription/running-plan';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { assertLiveSessionOf, type SessionCaller } from '../streaming-session/session-owner';
import { planCues } from './ad-schedule';

/**
 * How early the reported playhead may sit before the cue and still count (P4-2): it absorbs
 * keyframe granularity and the player's trigger delay.
 */
const AD_IMPRESSION_TOLERANCE_SECONDS = 30;

/**
 * P4-3: a completion claim is accepted once the ad itself could have played. Two seconds
 * absorb player-timer and network jitter without letting an instant "finished" call through.
 */
const AD_COMPLETION_TOLERANCE_SECONDS = 2;

export interface AdScheduleItem {
  breakId: string;
  positionSeconds: number;
  ad: { id: string; title: string; mediaUrl: string; clickUrl: string | null; durationSeconds: number };
}

/**
 * Mid-roll cues (flow 3, steps 12–13, 16–17). Schedule and impression share one
 * SessionAdBreak row: PENDING at session creation, COMPLETED when the player reaches or
 * seeks past the cue (the billable impression), SKIPPED when a later cue played instead. completedView is a separate, player-confirmed
 * signal that the ad played to the end — never inferred from the start call (P4-3).
 */
@Injectable()
export class AdBreakService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingService,
  ) {}

  /**
   * Step 13: lays the session's mid-roll cues (BR-32, BR-51). The cues the Admin placed on the
   * episode decide where and how many; an episode without any gets adMaxBreaksPerEpisode random
   * cues. Each cue holds its pinned ad or a weighted draw among the currently valid ads.
   *
   * ad-free comes from the plan snapshot create() already read; this service never queries
   * subscriptions. Cross-session / per-viewer frequency caps are not tracked yet.
   */
  async scheduleFor(
    sessionId: string,
    input: { episodeId: string; adFree: boolean; durationSeconds: number | null },
  ): Promise<AdScheduleItem[]> {
    if (input.adFree || !input.durationSeconds) return [];
    const [settings, eligible, slots] = await Promise.all([
      this.settings.get(),
      this.prisma.ad.findMany({ where: { status: AdStatus.ACTIVE } }),
      this.prisma.episodeAdSlot.findMany({
        where: { episodeId: input.episodeId },
        select: { positionSeconds: true, adId: true },
      }),
    ]);
    const cues = planCues({
      slots,
      eligible,
      durationSeconds: input.durationSeconds,
      fallbackCount: settings.adMaxBreaksPerEpisode,
    });
    if (!cues.length) return [];
    // P4-1: one INSERT is atomic, so a mid-way failure can never leave half a schedule.
    // skipDuplicates makes a concurrent double-schedule reuse the cues already laid
    // instead of answering the whole POST /sessions with a unique-constraint 500.
    await this.prisma.sessionAdBreak.createMany({
      data: cues.map((cue) => ({ streamingSessionId: sessionId, ...cue })),
      skipDuplicates: true,
    });
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
   * P4-2: an impression is money, so a call before the player reached the cue (minus a small
   * tolerance) is refused with AD_BREAK_NOT_REACHED: a player that calls `played` for every cue
   * when the movie opens bills nobody.
   *
   * BR-32/33: a forward seek over a cue does not skip the ad. The heartbeat names the cue the
   * playhead passed (dueAdBreakId) and the player plays it now, so a call past the cue counts.
   * Seeking over several cues plays only the last one; the earlier cues still pending are closed
   * as SKIPPED so a viewer never sits through a stack of ads, and none of them triggers again.
   *
   * P4-3: starting an ad is not a completed view. `completedView` stays false here and is only
   * set by markCompleted after the player confirms the ad actually finished.
   *
   * The playhead is still client-reported: this is a bar against buggy or casual callers, not
   * cryptographic proof of playback; segment-level verification is the stronger follow-up.
   */
  async markPlayed(sessionId: string, breakId: string, caller: SessionCaller, input: { positionSeconds: number }) {
    const row = await this.ownedBreak(sessionId, breakId, caller);
    if (row.status !== AdBreakStatus.PENDING) {
      return adBreakView(row);
    }
    if (input.positionSeconds < row.positionSeconds - AD_IMPRESSION_TOLERANCE_SECONDS) {
      throw new ConflictException({
        message: 'The player has not reached this ad break yet',
        details: {
          reason: 'AD_BREAK_NOT_REACHED',
          cuePositionSeconds: row.positionSeconds,
          positionSeconds: input.positionSeconds,
          toleranceSeconds: AD_IMPRESSION_TOLERANCE_SECONDS,
        },
      });
    }
    const [played] = await this.prisma.$transaction([
      this.prisma.sessionAdBreak.update({
        where: { id: row.id },
        // P4-3: the start call records the impression only; completion needs its own confirmation.
        data: { status: AdBreakStatus.COMPLETED, playedAt: new Date(), completedView: false },
      }),
      this.prisma.sessionAdBreak.updateMany({
        where: {
          streamingSessionId: sessionId,
          status: AdBreakStatus.PENDING,
          positionSeconds: { lt: row.positionSeconds },
        },
        data: { status: AdBreakStatus.SKIPPED },
      }),
    ]);
    return adBreakView(played);
  }

  /**
   * BR-33: the pending cue the playhead has passed, i.e. the ad the player must play now — the
   * latest one when a seek jumped over several. null when no ad is due.
   */
  async dueBreakOf(sessionId: string, positionSeconds: number): Promise<string | null> {
    const due = await this.prisma.sessionAdBreak.findFirst({
      where: {
        streamingSessionId: sessionId,
        status: AdBreakStatus.PENDING,
        positionSeconds: { lte: positionSeconds },
      },
      orderBy: { positionSeconds: 'desc' },
      select: { id: true },
    });
    return due?.id ?? null;
  }

  /**
   * P4-3: the player reports that the ad played to the end. Completion is never inferred
   * from the start call: the break must already be COMPLETED, and at least the ad's own
   * duration (minus a small clock tolerance) must have elapsed on the server clock. This
   * keeps advertiser completion numbers honest instead of claiming every impression
   * completed the moment it began.
   *
   * The elapsed-time gate proves enough time passed, not that the ad was on screen;
   * segment-level telemetry is the stronger follow-up. Like the start call, this is
   * idempotent: a retried confirmation returns the row.
   */
  async markCompleted(sessionId: string, breakId: string, caller: SessionCaller) {
    const row = await this.ownedBreak(sessionId, breakId, caller);
    if (row.status !== AdBreakStatus.COMPLETED || !row.playedAt) {
      throw new ConflictException({
        message: 'The ad break has not started yet',
        details: { reason: 'AD_BREAK_NOT_PLAYED' },
      });
    }
    if (row.completedView) return adBreakView(row);
    const elapsedSeconds = (Date.now() - row.playedAt.getTime()) / 1000;
    const requiredSeconds = Math.max(1, row.ad.durationSeconds - AD_COMPLETION_TOLERANCE_SECONDS);
    if (elapsedSeconds < requiredSeconds) {
      throw new ConflictException({
        message: 'The ad has not finished playing yet',
        details: {
          reason: 'AD_BREAK_NOT_FINISHED',
          elapsedSeconds: Math.floor(elapsedSeconds),
          requiredSeconds,
        },
      });
    }
    const completed = await this.prisma.sessionAdBreak.update({
      where: { id: row.id },
      data: { completedView: true },
    });
    return adBreakView(completed);
  }

  /**
   * The break only its session owner may touch, checked against the caller and the
   * session's liveness. Shared by start and completion so both answer the same errors.
   */
  private async ownedBreak(sessionId: string, breakId: string, caller: SessionCaller) {
    const row = await this.prisma.sessionAdBreak.findUnique({
      where: { id: breakId },
      include: { session: true, ad: { select: { durationSeconds: true } } },
    });
    if (!row || row.streamingSessionId !== sessionId) {
      throw new NotFoundException({
        message: 'Ad break not found',
        details: { reason: 'AD_BREAK_NOT_FOUND' },
      });
    }
    assertLiveSessionOf(row.session, caller);
    return row;
  }
}

/**
 * P4-5: whether the running plan removes ads, read off the snapshot create() already
 * fetched. Only a literal `true` counts: missing/typed-wrong JSON leaves ads on.
 */
export function isAdFreePlan(runningPlan: Pick<RunningPlanSnapshot, 'features'> | null): boolean {
  const features = runningPlan?.features;
  if (!features || typeof features !== 'object' || Array.isArray(features)) return false;
  return (features as { adFree?: unknown }).adFree === true;
}

function adBreakView(row: { id: string; status: AdBreakStatus; playedAt: Date | null; completedView: boolean }) {
  return {
    breakId: row.id,
    status: row.status,
    playedAt: row.playedAt,
    completedView: row.completedView,
  };
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
