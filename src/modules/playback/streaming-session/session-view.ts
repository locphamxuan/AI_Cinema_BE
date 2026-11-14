import { BadRequestException } from '@nestjs/common';
import type { StreamingSession, StreamingSessionStatus } from '@prisma/client';
import type { SessionStateViewDto } from 'src/modules/playback/watch-progress/dto/session-state.view.dto';
import type { AdScheduleItem } from '../ad-break/ad-break.service';
import type { DeviceIdentity } from '../playback-access/device-eligibility.port';
import type { VerifiedPlayback } from '../playback-access/playback-access.service';
import type { StreamingSessionViewDto } from './dto/streaming-session.dto';

/** What a client sends to open a streaming session (step 11). */
export interface CreateSessionInput {
  episodeId: string;
  userId?: string;
  guestKey?: string;
  device?: DeviceIdentity;
  idempotencyKey?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

/** A session belongs to exactly one owner: a member, or a guest with a UUID v4 key. */
export function assertCreateSessionInput(input: Pick<CreateSessionInput, 'userId' | 'guestKey' | 'idempotencyKey'>) {
  const { userId, guestKey, idempotencyKey } = input;
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
  if (idempotencyKey && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException({
      message: 'Idempotency-Key must be at most 100 characters',
      details: { reason: 'IDEMPOTENCY_KEY_TOO_LONG' },
    });
  }
}

/** The state a heartbeat, stop or complete call answers with. */
export function sessionState(
  session: StreamingSession,
  completed: boolean,
  dueAdBreakId: string | null = null,
): SessionStateViewDto {
  return {
    sessionId: session.id,
    episodeId: session.episodeId,
    status: session.status,
    positionSeconds: session.lastPositionSeconds,
    totalWatchedSeconds: session.totalWatchedSeconds,
    completed,
    dueAdBreakId,
  };
}

/** The answer of `POST /playback/sessions`; flags appear only when they are true or known. */
export function sessionView(
  session: { id: string; status: StreamingSessionStatus; startPositionSeconds: number },
  verified: VerifiedPlayback,
  masterUrl: string,
  extra: {
    reused: boolean;
    resumePositionSeconds?: number | null;
    adSchedule?: AdScheduleItem[];
    idempotent?: boolean;
  },
): StreamingSessionViewDto {
  const { reused, resumePositionSeconds = null, adSchedule = [], idempotent = false } = extra;
  return {
    sessionId: session.id,
    episodeId: verified.episodeId,
    movieId: verified.movieId,
    accessType: verified.accessType,
    planCode: verified.planCode,
    status: session.status,
    startPositionSeconds: session.startPositionSeconds,
    stream: {
      masterUrl,
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
