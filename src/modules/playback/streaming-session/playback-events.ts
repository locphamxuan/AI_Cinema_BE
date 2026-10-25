import { type StreamingEndReason, type StreamingSession } from '@prisma/client';
import type { AuditEntry } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';

/**
 * Playback audit trail (hardening #12): a STARTED row when a session opens and an ENDED
 * row when it closes, so abuse and complaint investigations survive the session retention
 * sweep. movie_id stays null: viewer traffic is not a §4.1.6 content event, and attaching
 * it would flood GET /projects/:movieId/events (newest 100). Look rows up by session id or
 * by the episodeId and userId/guestKey in the payload.
 */

/** The session-row fields the STARTED row reads; a full row satisfies it. */
type StartedSession = Pick<StreamingSession, 'id' | 'userId' | 'guestKey' | 'episodeId' | 'accessType' | 'ipAddress'>;

/** The session-row fields the ENDED row reads; a full row satisfies it. */
type EndedSession = Pick<
  StreamingSession,
  'id' | 'userId' | 'guestKey' | 'episodeId' | 'lastPositionSeconds' | 'totalWatchedSeconds'
>;

/** Who closed the session: the viewer's own client, or the expiry sweep on its own. */
type ClosedBy = 'VIEWER' | 'SYSTEM';

/** One session opened (step 11). A guest viewer gets actorType GUEST: no account acted. */
export function sessionStarted(session: StartedSession): AuditEntry {
  return {
    action: CONTENT_EVENT.PLAYBACK_SESSION_STARTED,
    entityType: 'StreamingSession',
    entityId: session.id,
    movieId: null,
    actorId: session.userId,
    ...(session.userId ? {} : { actorType: 'GUEST' as const }),
    payload: {
      episodeId: session.episodeId,
      accessType: session.accessType,
      ...(session.userId ? { userId: session.userId } : {}),
      ...(session.guestKey ? { guestKey: session.guestKey } : {}),
      ...(session.ipAddress ? { ipAddress: session.ipAddress } : {}),
    },
  };
}

/**
 * One session closed (steps 18–21, a supersede rotation, or the expiry sweep): why it
 * ended and how far the viewer got. The sweep closes on its own, so it passes 'SYSTEM':
 * actorId is then null per the audit convention, while userId/guestKey in the payload
 * still name the viewer.
 */
export function sessionEnded(
  session: EndedSession,
  endReason: StreamingEndReason,
  closedBy: ClosedBy = 'VIEWER',
): AuditEntry {
  const system = closedBy === 'SYSTEM';
  return {
    action: CONTENT_EVENT.PLAYBACK_SESSION_ENDED,
    entityType: 'StreamingSession',
    entityId: session.id,
    movieId: null,
    actorId: system ? null : session.userId,
    ...(system || session.userId ? {} : { actorType: 'GUEST' as const }),
    payload: {
      episodeId: session.episodeId,
      endReason,
      positionSeconds: session.lastPositionSeconds,
      totalWatchedSeconds: session.totalWatchedSeconds,
      ...(session.userId ? { userId: session.userId } : {}),
      ...(session.guestKey ? { guestKey: session.guestKey } : {}),
    },
  };
}
