import { ConflictException } from '@nestjs/common';
import { Prisma, StreamingEndReason, StreamingSessionStatus, type StreamingSession } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { RunningPlanSnapshot } from 'src/modules/episode-access/subscription/running-plan';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { DeviceEligibilityPort } from '../playback-access/device-eligibility.port';
import type { VerifiedPlayback } from '../playback-access/playback-access.service';
import { maxQualityOf } from './playback-quality';
import { sessionEnded, sessionStarted } from './playback-events';
import type { CreateSessionInput } from './session-view';

interface OpeningDeps {
  prisma: PrismaService;
  settings: PlatformSettingService;
  audit: AuditLogService;
  devices: DeviceEligibilityPort;
}

export interface OpenedSession {
  session: StreamingSession;
  reused: boolean;
  idempotent: boolean;
}

/**
 * One key names one creation intent. Reusing it for another owner or episode is a client
 * bug (keys must be fresh UUIDs per intent), answered 409 — never another session.
 */
function assertSameIntent(prior: StreamingSession, input: CreateSessionInput): void {
  const { userId, guestKey } = input;
  const same = prior.episodeId === input.episodeId && (userId ? prior.userId === userId : prior.guestKey === guestKey);
  if (!same) {
    throw new ConflictException({
      message: 'This Idempotency-Key was already used for another session',
      details: { reason: 'IDEMPOTENCY_KEY_REUSED' },
    });
  }
}

/** Finds the session a retry or a double tap should get back, or inserts a new one (step 11). */
export async function openSessionRow(
  deps: OpeningDeps,
  input: CreateSessionInput,
  context: { verified: VerifiedPlayback; memberPlan: RunningPlanSnapshot | null; deviceId: string | null },
): Promise<OpenedSession> {
  const { userId, guestKey, idempotencyKey } = input;
  const { verified, memberPlan, deviceId } = context;
  // F-2: the device count, the live-session lookup and the insert serialize on a
  // per-owner advisory lock. The lock releases with the transaction, so a second
  // concurrent tap always sees the first tap's row and reuses it instead of
  // doubling the session (and its ad-break schedule).
  const ownerKey = userId ? `member:${userId}` : `guest:${guestKey}`;
  try {
    return await deps.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'playback:' + ownerKey}))`;
      const now = new Date();
      if (idempotencyKey) {
        // Same key + same owner + same episode replays the first session, even when it
        // already ended: the key names one creation intent, so a retry answers identically.
        const prior = await tx.streamingSession.findFirst({ where: { idempotencyKey } });
        if (prior) {
          assertSameIntent(prior, input);
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
            await deps.audit.record(sessionEnded(prior, StreamingEndReason.SUPERSEDED), tx);
          } else {
            return { session: prior, reused: true, idempotent: true };
          }
        }
      }

      // Double taps share one live session: an ACTIVE row on the same episode whose
      // heartbeat has not timed out is handed back instead of opening a second row —
      // but only while it still points at the current media version. A re-publish
      // rotates the row so no token or URL ever mixes two versions.
      const { playbackHeartbeatTimeoutSeconds } = await deps.settings.get();
      const aliveSince = new Date(Date.now() - playbackHeartbeatTimeoutSeconds * 1000);
      const live = await tx.streamingSession.findFirst({
        where: {
          episodeId: input.episodeId,
          status: StreamingSessionStatus.ACTIVE,
          lastHeartbeatAt: { gt: aliveSince },
          ...(userId ? { userId, deviceId } : { guestKey }),
        },
        orderBy: { startedAt: 'desc' },
      });
      if (live && live.mediaAssetId !== verified.mediaAssetId) {
        await tx.streamingSession.update({
          where: { id: live.id },
          data: { status: StreamingSessionStatus.ENDED, endReason: StreamingEndReason.SUPERSEDED, endedAt: now },
        });
        await deps.audit.record(sessionEnded(live, StreamingEndReason.SUPERSEDED), tx);
      } else if (live) {
        return { session: live, reused: true, idempotent: false };
      }
      // Only a new row takes a slot: the reuse above runs first so a member at the limit who
      // reloads the episode gets the session back, and a superseded row is already freed.
      if (userId) await deps.devices.check(userId, memberPlan, tx, deviceId);

      const created = await tx.streamingSession.create({
        data: {
          userId: userId ?? null,
          guestKey: guestKey ?? null,
          deviceId,
          episodeId: verified.episodeId,
          mediaAssetId: verified.mediaAssetId,
          // Cached once here so every later beat reads the length off this row.
          durationSeconds: verified.durationSeconds,
          accessType: verified.accessType,
          // Pinned once: the playlist endpoints read the ceiling off this row.
          maxQuality: maxQualityOf(memberPlan?.features),
          status: StreamingSessionStatus.ACTIVE,
          startPositionSeconds: 0,
          lastPositionSeconds: 0,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      await deps.audit.record(sessionStarted(created), tx);
      return { session: created, reused: false, idempotent: false };
    });
  } catch (error) {
    // Two owners racing the same key serialize on different locks; the unique index is
    // the backstop — re-read the winner and replay it instead of answering 500.
    if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const prior = await deps.prisma.streamingSession.findFirst({ where: { idempotencyKey } });
      if (prior) {
        assertSameIntent(prior, input);
        return { session: prior, reused: true, idempotent: true };
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }
}
