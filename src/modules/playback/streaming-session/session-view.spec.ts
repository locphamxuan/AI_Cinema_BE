import { BadRequestException } from '@nestjs/common';
import { StreamingSessionStatus, type StreamingSession } from '@prisma/client';
import type { VerifiedPlayback } from '../playback-access/playback-access.service';
import { assertCreateSessionInput, sessionState, sessionView } from './session-view';

const GUEST_KEY = '3f1c2a4e-5b6d-4c7e-8f90-a1b2c3d4e5f6';

function reasonOf(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { details: { reason: string } }).details.reason;
  }
  return undefined;
}

describe('session-view', () => {
  it('accepts exactly one owner with a well-formed key', () => {
    expect(reasonOf(() => assertCreateSessionInput({ userId: 'u1' }))).toBeUndefined();
    expect(reasonOf(() => assertCreateSessionInput({ guestKey: GUEST_KEY }))).toBeUndefined();
    expect(reasonOf(() => assertCreateSessionInput({}))).toBe('GUEST_KEY_REQUIRED');
    expect(reasonOf(() => assertCreateSessionInput({ userId: 'u1', guestKey: GUEST_KEY }))).toBe('OWNER_CONFLICT');
    expect(reasonOf(() => assertCreateSessionInput({ guestKey: 'not-a-uuid' }))).toBe('GUEST_KEY_INVALID');
    expect(reasonOf(() => assertCreateSessionInput({ userId: 'u1', idempotencyKey: 'k'.repeat(101) }))).toBe(
      'IDEMPOTENCY_KEY_TOO_LONG',
    );
  });

  it('maps a session row to its state view', () => {
    const row = {
      id: 's1',
      episodeId: 'e1',
      status: StreamingSessionStatus.ACTIVE,
      lastPositionSeconds: 42,
      totalWatchedSeconds: 30,
    } as StreamingSession;
    expect(sessionState(row, false)).toEqual({
      sessionId: 's1',
      episodeId: 'e1',
      status: StreamingSessionStatus.ACTIVE,
      positionSeconds: 42,
      totalWatchedSeconds: 30,
      completed: false,
      dueAdBreakId: null,
    });
    expect(sessionState(row, true, 'b1').dueAdBreakId).toBe('b1');
  });

  it('only adds the reused, idempotent and resume flags when they apply', () => {
    const verified = {
      episodeId: 'e1',
      movieId: 'm1',
      accessType: 'FREE_STARTER',
      planCode: null,
      qualities: ['720p'],
      durationSeconds: 600,
      subtitles: [{ language: 'vi', fileUrl: 'https://x/vi.vtt', isDefault: true }],
      aiLabel: { text: 'AI' },
    } as unknown as VerifiedPlayback;
    const session = { id: 's1', status: StreamingSessionStatus.ACTIVE, startPositionSeconds: 0 };

    const fresh = sessionView(session, verified, 'https://api/master.m3u8', { reused: false });
    expect(fresh).toEqual({
      sessionId: 's1',
      episodeId: 'e1',
      movieId: 'm1',
      accessType: 'FREE_STARTER',
      planCode: null,
      status: StreamingSessionStatus.ACTIVE,
      startPositionSeconds: 0,
      stream: { masterUrl: 'https://api/master.m3u8', qualities: ['720p'], durationSeconds: 600 },
      subtitles: [{ language: 'vi', url: 'https://x/vi.vtt', isDefault: true }],
      aiLabel: { text: 'AI' },
      adSchedule: [],
    });

    const replay = sessionView(session, verified, 'u', { reused: true, idempotent: true, resumePositionSeconds: 90 });
    expect(replay).toMatchObject({ reused: true, idempotent: true, resumePositionSeconds: 90 });
  });
});
