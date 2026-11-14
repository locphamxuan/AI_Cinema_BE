import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EpisodeStatus, StreamingEndReason, type StreamingSession } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { DeviceEligibilityPort } from '../playback-access/device-eligibility.port';
import { PlaybackAccessService } from '../playback-access/playback-access.service';
import { WatchProgressService } from '../watch-progress/watch-progress.service';
import { AdBreakService, isAdFreePlan } from '../ad-break/ad-break.service';
import { PlaybackUrlService } from './playback-url.service';
import { assertLiveSessionOf, type SessionCaller } from './session-owner';
import { openSessionRow } from './session-opening';
import { saveViewing, type ViewingUpdate } from './session-viewing';
import { assertCreateSessionInput, sessionState, sessionView, type CreateSessionInput } from './session-view';
import { progressWriteDue } from './watch-pacing';
import type { StreamingSessionViewDto } from './dto/streaming-session.dto';
import type { SessionStateViewDto } from 'src/modules/playback/watch-progress/dto/session-state.view.dto';

/** The episode after this one (flow 3, steps 22–24); null when the movie ends here. */
export interface NextEpisodeView {
  movieId: string;
  episodeId: string | null;
  episodeNumber: number | null;
  title: string | null;
}

/**
 * Main Flow 3: verifies playback access, opens streaming sessions (step 11) and
 * tracks viewing through heartbeats until the viewer stops or finishes (steps
 * 15, 18–21). Guests always start from 0 and keep no progress row.
 */
@Injectable()
export class StreamingSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PlaybackAccessService,
    private readonly devices: DeviceEligibilityPort,
    private readonly settings: PlatformSettingService,
    private readonly urls: PlaybackUrlService,
    private readonly progress: WatchProgressService,
    private readonly ads: AdBreakService,
    private readonly audit: AuditLogService,
  ) {}

  async create(input: CreateSessionInput): Promise<StreamingSessionViewDto> {
    assertCreateSessionInput(input);
    const { userId } = input;

    // P4-5: one plan read for the whole request. The same snapshot answers access,
    // the device limit and ad-free, so a paid session never reads the subscription
    // three times. Guests have no plan and skip the read entirely.
    const runningPlan = userId ? await this.access.runningPlanOf(userId) : null;
    const verified = await this.access.verify(input.episodeId, userId, runningPlan);
    // BR-34: a member without a running plan is on the Free plan, whose stream limit and ads
    // the Admin configures like any other plan. Guests have no plan and no stream limit.
    const memberPlan = userId ? (runningPlan ?? (await this.access.freePlanOf())) : null;
    const deviceId = userId ? await this.devices.register(userId, input.device, memberPlan) : null;

    const outcome = await openSessionRow(
      { prisma: this.prisma, settings: this.settings, audit: this.audit, devices: this.devices },
      input,
      { verified, memberPlan, deviceId },
    );
    const { session, reused, idempotent } = outcome;
    const masterUrl = this.urls.masterUrl(session.id, {
      id: verified.mediaAssetId,
      streamUrl: verified.streamUrl,
      isSelfHosted: verified.isSelfHosted,
    });
    if (reused) {
      return sessionView(session, verified, masterUrl, {
        reused: true,
        adSchedule: await this.ads.scheduleOf(session.id),
        idempotent,
      });
    }
    return sessionView(session, verified, masterUrl, {
      reused: false,
      resumePositionSeconds: await this.resumeOf(userId, verified.episodeId),
      adSchedule: await this.ads.scheduleFor(session.id, {
        episodeId: verified.episodeId,
        adFree: isAdFreePlan(memberPlan),
        durationSeconds: verified.durationSeconds,
      }),
      idempotent,
    });
  }

  /**
   * Step 15: heartbeat keeps the session alive and persists the position. The session row
   * takes every beat (liveness feeds the expiry sweep); the member's resume hint lands at
   * most once a minute — and always on the beat that crosses the completion threshold. Before anything is
   * credited, the beat re-checks that the entitlement is still there (hardening #11).
   */
  async heartbeat(
    sessionId: string,
    caller: SessionCaller,
    input: { positionSeconds: number; watchedSeconds?: number },
  ): Promise<SessionStateViewDto> {
    const session = await this.owned(sessionId, caller);
    // A take-down for good revokes the unlock and refunds it (BR-52); a plan can lapse. The
    // session ends here instead of riding its heartbeat timeout, so the player is told to
    // stop and the signed playlist URLs pinned to this row stop being served.
    if (!(await this.access.stillEntitled(session))) {
      await this.kicked(session, input.positionSeconds);
      throw new ForbiddenException({
        message: 'Playback access was revoked while the session was open',
        details: { reason: 'PLAYBACK_ACCESS_REVOKED' },
      });
    }
    const saved = await this.saveViewing(session, {
      positionSeconds: input.positionSeconds,
      watchedSeconds: input.watchedSeconds,
      endReason: null,
      persistProgress: progressWriteDue(session, new Date()),
    });
    return sessionState(
      saved.session,
      saved.completed,
      await this.ads.dueBreakOf(session.id, saved.session.lastPositionSeconds),
    );
  }

  /** Step 19/21: the viewer stops; the position is saved and the slot is freed. */
  async stop(
    sessionId: string,
    caller: SessionCaller,
    input: { positionSeconds: number },
  ): Promise<SessionStateViewDto> {
    const session = await this.owned(sessionId, caller);
    const saved = await this.saveViewing(session, {
      positionSeconds: input.positionSeconds,
      endReason: StreamingEndReason.STOPPED,
      // Whatever the cadence, the last position must land before the session closes.
      persistProgress: true,
    });
    return sessionState(saved.session, saved.completed);
  }

  /**
   * Step 18/20: the player reports that playback ended. Finishing is not a completion
   * claim (P3-3): the episode is marked completed only when the final position reaches
   * `episodeCompletionPercent`, the same rule heartbeats and the expiry sweep apply.
   * Below the threshold the session closes like a stop, so one call can no longer
   * inflate history/completion stats.
   */
  async complete(
    sessionId: string,
    caller: SessionCaller,
    input: { positionSeconds?: number },
  ): Promise<SessionStateViewDto> {
    const session = await this.owned(sessionId, caller);
    const saved = await this.saveViewing(session, {
      positionSeconds: input.positionSeconds ?? session.lastPositionSeconds,
      // saveViewing upgrades this to COMPLETED only when the threshold is actually crossed.
      endReason: StreamingEndReason.STOPPED,
      persistProgress: true,
    });
    return sessionState(saved.session, saved.completed);
  }

  /** Ends a session whose entitlement vanished mid-viewing: position saved, row closed as KICKED. */
  private async kicked(session: StreamingSession, positionSeconds: number): Promise<void> {
    await this.saveViewing(session, {
      positionSeconds,
      endReason: StreamingEndReason.KICKED,
      persistProgress: true,
    });
  }

  /** The session only its owner may touch; anything else goes back to the catalog. */
  private async owned(sessionId: string, caller: SessionCaller): Promise<StreamingSession> {
    const session = await this.prisma.streamingSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException({
        message: 'Streaming session not found',
        details: { reason: 'SESSION_NOT_FOUND' },
      });
    }
    assertLiveSessionOf(session, caller);
    return session;
  }

  private saveViewing(session: StreamingSession, input: ViewingUpdate) {
    return saveViewing(
      { prisma: this.prisma, settings: this.settings, audit: this.audit, progress: this.progress },
      session,
      input,
    );
  }

  /** Step 9 hint for the resume-or-restart question; guests always get null. */
  private async resumeOf(userId: string | undefined, episodeId: string): Promise<number | null> {
    if (!userId) return null;
    const saved = await this.progress.progress(userId, episodeId);
    return saved.found && !saved.completed && saved.positionSeconds > 0 ? saved.positionSeconds : null;
  }

  /**
   * Steps 22–24: the episode after this one in the same movie, if it is out and playable.
   * Access is NOT granted here — the caller hands the id back to Main Flow 2.
   */
  async nextEpisode(episodeId: string): Promise<NextEpisodeView> {
    const current = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      select: { movieId: true, episodeNumber: true },
    });
    if (!current) {
      throw new NotFoundException({ message: 'Episode not found', details: { reason: 'EPISODE_NOT_FOUND' } });
    }
    const next = await this.prisma.episode.findFirst({
      where: {
        movieId: current.movieId,
        episodeNumber: { gt: current.episodeNumber },
        status: EpisodeStatus.PUBLISHED,
        revisionStartedAt: null,
      },
      orderBy: { episodeNumber: 'asc' },
      select: { id: true, movieId: true, episodeNumber: true, title: true },
    });
    if (!next) return { movieId: current.movieId, episodeId: null, episodeNumber: null, title: null };
    return { movieId: next.movieId, episodeId: next.id, episodeNumber: next.episodeNumber, title: next.title };
  }
}
