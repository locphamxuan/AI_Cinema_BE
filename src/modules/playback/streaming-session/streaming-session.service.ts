import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EpisodeStatus,
  Prisma,
  StreamingEndReason,
  StreamingSessionStatus,
  type StreamingSession,
} from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { DeviceEligibilityPort } from '../playback-access/device-eligibility.port';
import { PlaybackAccessService, type VerifiedPlayback } from '../playback-access/playback-access.service';
import { WatchProgressService } from '../watch-progress/watch-progress.service';
import { AdBreakService, type AdScheduleItem } from '../ad-break/ad-break.service';
import { PlaybackUrlService } from './playback-url.service';
import { sessionEnded, sessionStarted } from './playback-events';
import { progressWriteDue, watchCreditSeconds } from './watch-pacing';
import type { StreamingSessionViewDto } from './dto/streaming-session.dto';
import { SessionStateViewDto } from 'src/modules/playback/watch-progress/dto/session-state.view.dto';

export interface CreateSessionInput {
  episodeId: string;
  userId?: string;
  guestKey?: string;
  idempotencyKey?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Who is calling a session-owned route: the member, the guest key, or nobody. */
export interface SessionCaller {
  userId?: string;
  guestKey?: string;
}

/** The episode after this one (flow 3, steps 22–24); null when the movie ends here. */
export interface NextEpisodeView {
  movieId: string;
  episodeId: string | null;
  episodeNumber: number | null;
  title: string | null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const { userId, guestKey } = input;
    if (!userId && !guestKey) {
      throw new BadRequestException({
        message: 'Guests must send X-Guest-Key',
        details: { reason: 'GUEST_KEY_REQUIRED' },
      });
    }
    if (userId && guestKey) {
      throw new BadRequestException({
        message: 'A session belongs to either a member or a guest, never both',
        details: { reason: 'OWNER_CONFLICT' },
      });
    }
    if (guestKey && !UUID_V4.test(guestKey)) {
      throw new BadRequestException({
        message: 'X-Guest-Key must be a UUID v4',
        details: { reason: 'GUEST_KEY_INVALID' },
      });
    }
    const { idempotencyKey } = input;
    if (idempotencyKey && idempotencyKey.length > 100) {
      throw new BadRequestException({
        message: 'Idempotency-Key must be at most 100 characters',
        details: { reason: 'IDEMPOTENCY_KEY_TOO_LONG' },
      });
    }

    const verified = await this.access.verify(input.episodeId, userId);

    // F-2: the device count, the live-session lookup and the insert serialize on a
    // per-owner advisory lock. The lock releases with the transaction, so a second
    // concurrent tap always sees the first tap's row and reuses it instead of
    // doubling the session (and its ad-break schedule).
    const ownerKey = userId ? `member:${userId}` : `guest:${guestKey}`;
    let outcome: { session: StreamingSession; reused: boolean; idempotent: boolean };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'playback:' + ownerKey}))`;
        const now = new Date();
        if (idempotencyKey) {
          // Same key + same owner + same episode replays the first session, even when it
          // already ended: the key names one creation intent, so a retry answers identically.
          const prior = await tx.streamingSession.findFirst({ where: { idempotencyKey } });
          if (prior) {
            this.assertSameIntent(prior, input);
            // …unless the episode was re-published since: a token/URL pinned to the new
            // version must never ride on a row pinned to the old one. The key moves to
            // the fresh row so the next retry replays the new answer.
            if (prior.mediaAssetId !== verified.mediaAssetId) {
              await tx.streamingSession.update({
                where: { id: prior.id },
                data: {
                  status: StreamingSessionStatus.ENDED,
                  endReason: StreamingEndReason.SUPERSEDED,
                  endedAt: now,
                  idempotencyKey: null,
                },
              });
              await this.audit.record(sessionEnded(prior, StreamingEndReason.SUPERSEDED), tx);
            } else {
              return { session: prior, reused: true, idempotent: true };
            }
          }
        }
        if (userId) await this.devices.check(userId, tx);

        // Double taps share one live session: an ACTIVE row on the same episode whose
        // heartbeat has not timed out is handed back instead of opening a second row —
        // but only while it still points at the current media version. A re-publish
        // rotates the row so no token or URL ever mixes two versions.
        const { playbackHeartbeatTimeoutSeconds } = await this.settings.get();
        const aliveSince = new Date(Date.now() - playbackHeartbeatTimeoutSeconds * 1000);
        const live = await tx.streamingSession.findFirst({
          where: {
            episodeId: input.episodeId,
            status: StreamingSessionStatus.ACTIVE,
            lastHeartbeatAt: { gt: aliveSince },
            ...(userId ? { userId } : { guestKey }),
          },
          orderBy: { startedAt: 'desc' },
        });
        if (live && live.mediaAssetId !== verified.mediaAssetId) {
          await tx.streamingSession.update({
            where: { id: live.id },
            data: { status: StreamingSessionStatus.ENDED, endReason: StreamingEndReason.SUPERSEDED, endedAt: now },
          });
          await this.audit.record(sessionEnded(live, StreamingEndReason.SUPERSEDED), tx);
        } else if (live) {
          return { session: live, reused: true, idempotent: false };
        }

        const created = await tx.streamingSession.create({
          data: {
            userId: userId ?? null,
            guestKey: guestKey ?? null,
            episodeId: verified.episodeId,
            mediaAssetId: verified.mediaAssetId,
            // Cached once here so every later beat reads the length off this row.
            durationSeconds: verified.durationSeconds,
            accessType: verified.accessType,
            status: StreamingSessionStatus.ACTIVE,
            startPositionSeconds: 0,
            lastPositionSeconds: 0,
            ipAddress: input.ipAddress ?? null,
            userAgent: input.userAgent?.slice(0, 500) ?? null,
            idempotencyKey: idempotencyKey ?? null,
          },
        });
        await this.audit.record(sessionStarted(created), tx);
        return { session: created, reused: false, idempotent: false };
      });
    } catch (error) {
      // Two owners racing the same key serialize on different locks; the unique index is
      // the backstop — re-read the winner and replay it instead of answering 500.
      if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const prior = await this.prisma.streamingSession.findFirst({ where: { idempotencyKey } });
        if (prior) {
          this.assertSameIntent(prior, input);
          outcome = { session: prior, reused: true, idempotent: true };
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    const { session, reused, idempotent } = outcome;
    if (reused) return this.view(session, verified, true, null, await this.ads.scheduleOf(session.id), idempotent);
    return this.view(
      session,
      verified,
      false,
      await this.resumeOf(userId, verified.episodeId),
      await this.ads.scheduleFor(session.id, { userId, durationSeconds: verified.durationSeconds }),
      idempotent,
    );
  }

  /**
   * One key names one creation intent. Reusing it for another owner or episode is a client
   * bug (keys must be fresh UUIDs per intent), answered 409 — never another session.
   */
  private assertSameIntent(prior: StreamingSession, input: CreateSessionInput): void {
    const { userId, guestKey } = input;
    const same =
      prior.episodeId === input.episodeId && (userId ? prior.userId === userId : prior.guestKey === guestKey);
    if (!same) {
      throw new ConflictException({
        message: 'This Idempotency-Key was already used for another session',
        details: { reason: 'IDEMPOTENCY_KEY_REUSED' },
      });
    }
  }

  /**
   * Step 15: heartbeat keeps the session alive and persists the position. The session row
   * takes every beat (liveness feeds the expiry sweep); the member's resume hint lands at
   * most once a minute — and always when this beat ends the session. Before anything is
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
    return this.state(saved.session, saved.completed);
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
    return this.state(saved.session, saved.completed);
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
    return this.state(saved.session, saved.completed);
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
    const mine = session.userId
      ? Boolean(caller.userId) && session.userId === caller.userId
      : Boolean(caller.guestKey) && session.guestKey === caller.guestKey;
    if (!mine) {
      throw new ForbiddenException({
        message: 'This session belongs to someone else',
        details: { reason: 'SESSION_NOT_OWNER' },
      });
    }
    if (session.status !== StreamingSessionStatus.ACTIVE) {
      this.notActive();
    }
    return session;
  }

  /** The one answer for a row that is no longer ACTIVE, whichever path notices it. */
  private notActive(): never {
    throw new ForbiddenException({
      message: 'The streaming session is no longer active',
      details: { reason: 'SESSION_NOT_ACTIVE' },
    });
  }

  /**
   * One viewing update: clamps the position to the cached media length, credits watch
   * time from the server clock, crosses the completion threshold from platform settings,
   * and — for members, on the cadence the caller asks for — persists the progress row.
   * Guests keep nothing.
   */
  private async saveViewing(
    session: StreamingSession,
    input: {
      positionSeconds: number;
      /** The client's claim since the last update; it may only lower the server's credit. */
      watchedSeconds?: number;
      endReason: StreamingEndReason | null;
      /** false on a heartbeat inside the write window; stop and complete always pass true. */
      persistProgress: boolean;
    },
  ): Promise<{ session: StreamingSession; completed: boolean }> {
    const now = new Date();
    // Watch time is credited from the server clock — the gap since the previous update on
    // this row — never by summing what the client claims; the claim only clamps it down.
    const credited = watchCreditSeconds(session.lastHeartbeatAt, now, input.watchedSeconds);
    // The media length was cached on the row at creation: no media_assets read per beat.
    const duration = session.durationSeconds;
    const position = duration
      ? Math.min(Math.max(0, Math.floor(input.positionSeconds)), duration)
      : Math.max(0, Math.floor(input.positionSeconds));
    const { episodeCompletionPercent } = await this.settings.get();
    const crossed = Boolean(duration) && duration! > 0 && (position / duration!) * 100 >= episodeCompletionPercent;
    // Completion is always derived here, never asserted by the caller (P3-3).
    const completed = crossed;
    const endReason = completed ? StreamingEndReason.COMPLETED : input.endReason;
    // A session that ends now (stop/complete, or a beat that crossed the threshold) must
    // leave its final position behind; otherwise the once-a-minute cadence applies.
    const writeProgress = Boolean(session.userId) && (input.persistProgress || endReason !== null);

    const written = await this.prisma.streamingSession.updateMany({
      // P3-2: the row may have been closed by a concurrent stop/complete after owned() read it.
      // Guard the write on ACTIVE so a late heartbeat cannot write a position onto an ENDED row.
      where: { id: session.id, status: StreamingSessionStatus.ACTIVE },
      data: {
        lastPositionSeconds: position,
        lastHeartbeatAt: now,
        totalWatchedSeconds: { increment: credited },
        ...(writeProgress ? { lastProgressAt: now } : {}),
        ...(endReason ? { status: StreamingSessionStatus.ENDED, endReason, endedAt: now } : {}),
      },
    });
    if (written.count === 0) this.notActive();
    // updateMany returns no row: rebuild the fields the response and the audit row read.
    const current: StreamingSession = {
      ...session,
      lastPositionSeconds: position,
      lastHeartbeatAt: now,
      totalWatchedSeconds: session.totalWatchedSeconds + credited,
      lastProgressAt: writeProgress ? now : session.lastProgressAt,
      ...(endReason ? { status: StreamingSessionStatus.ENDED, endReason, endedAt: now } : {}),
    };
    // Hardening #12: record the close right where it happens — the session row is deleted later.
    if (endReason) await this.audit.record(sessionEnded(current, endReason));
    if (writeProgress && session.userId) {
      await this.progress.save(session.userId, session.episodeId, {
        positionSeconds: position,
        durationSeconds: duration,
        completed,
        at: now,
      });
    }
    return { session: current, completed };
  }

  private state(session: StreamingSession, completed: boolean): SessionStateViewDto {
    return {
      sessionId: session.id,
      episodeId: session.episodeId,
      status: session.status,
      positionSeconds: session.lastPositionSeconds,
      totalWatchedSeconds: session.totalWatchedSeconds,
      completed,
    };
  }

  /** Step 9 hint for the resume-or-restart question; guests always get null. */
  private async resumeOf(userId: string | undefined, episodeId: string): Promise<number | null> {
    if (!userId) return null;
    const saved = await this.progress.progress(userId, episodeId);
    return saved.found && !saved.completed && saved.positionSeconds > 0 ? saved.positionSeconds : null;
  }

  /**
   * Steps 22–24: the episode after this one in the same movie, if it is out.
   * Access is NOT granted here — the caller hands the id back to Main Flow 2.
   */
  async nextEpisode(episodeId: string): Promise<NextEpisodeView> {
    const current = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      select: { movieId: true, episodeNumber: true },
    });
    if (!current) {
      throw new NotFoundException({
        message: 'Episode not found',
        details: { reason: 'EPISODE_NOT_FOUND' },
      });
    }
    const next = await this.prisma.episode.findFirst({
      where: {
        movieId: current.movieId,
        episodeNumber: { gt: current.episodeNumber },
        status: EpisodeStatus.PUBLISHED,
      },
      orderBy: { episodeNumber: 'asc' },
      select: { id: true, movieId: true, episodeNumber: true, title: true },
    });
    if (!next) return { movieId: current.movieId, episodeId: null, episodeNumber: null, title: null };
    return { movieId: next.movieId, episodeId: next.id, episodeNumber: next.episodeNumber, title: next.title };
  }

  private view(
    session: {
      id: string;
      status: StreamingSessionStatus;
      startPositionSeconds: number;
    },
    verified: VerifiedPlayback,
    reused: boolean,
    resumePositionSeconds: number | null = null,
    adSchedule: AdScheduleItem[] = [],
    idempotent = false,
  ): StreamingSessionViewDto {
    return {
      sessionId: session.id,
      episodeId: verified.episodeId,
      movieId: verified.movieId,
      accessType: verified.accessType,
      planCode: verified.planCode,
      status: session.status,
      startPositionSeconds: session.startPositionSeconds,
      stream: {
        masterUrl: this.urls.masterUrl(session.id, {
          id: verified.mediaAssetId,
          streamUrl: verified.streamUrl,
          isSelfHosted: verified.isSelfHosted,
        }),
        qualities: verified.qualities,
        durationSeconds: verified.durationSeconds,
      },
      subtitles: verified.subtitles.map((subtitle) => ({
        language: subtitle.language,
        url: subtitle.fileUrl,
        isDefault: subtitle.isDefault,
      })),
      aiLabel: verified.aiLabel,
      adSchedule,
      ...(reused ? { reused: true } : {}),
      ...(idempotent ? { idempotent: true } : {}),
      ...(resumePositionSeconds !== null ? { resumePositionSeconds } : {}),
    };
  }
}
