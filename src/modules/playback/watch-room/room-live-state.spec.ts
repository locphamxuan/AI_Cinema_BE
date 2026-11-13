import { CodeGuessLimiter, formatRoomCode, generateRoomCode, normalizeRoomCode } from './room-codes';
import { HOST_PAUSE_WARN_MS, HOST_VOTE_OPEN_MS } from './room-events';
import { LiveRooms, PlaybackThrottle } from './room-live-state';

describe('room codes (edge 4.1)', () => {
  it('generates 6 characters without look-alikes and shows them as XXX-XXX', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
    expect(formatRoomCode('AB2CD9')).toBe('AB2-CD9');
    expect(normalizeRoomCode(' ab2-cd9 ')).toBe('AB2CD9');
  });

  it('locks a caller for 15 minutes after 5 wrong codes in 10 minutes', () => {
    const limiter = new CodeGuessLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) limiter.recordFailure('u', t0 + i);
    expect(() => limiter.assertNotLocked('u', t0 + 10)).toThrow();
    expect(() => limiter.assertNotLocked('u', t0 + 15 * 60 * 1000 + 10)).not.toThrow();
  });

  it('forgets failures older than the window', () => {
    const limiter = new CodeGuessLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure('u', i);
    limiter.recordFailure('u', 11 * 60 * 1000);
    expect(() => limiter.assertNotLocked('u', 11 * 60 * 1000 + 1)).not.toThrow();
  });
});

describe('LiveRooms', () => {
  it('extrapolates the Host clock while playing (edges 2.1, 2.2)', () => {
    const live = new LiveRooms();
    live.seed('r', 'h', 'PAUSED', 0);
    live.sync('r', 'PLAYING', 930.5, 1000);
    expect(live.positionNow('r', 3000)).toBeCloseTo(932.5);
    live.sync('r', 'PAUSED', 940, 4000);
    expect(live.positionNow('r', 9000)).toBe(940);
  });

  it('warns the Host after 5 min of pause, then opens a vote 1 min later (edge 3.3)', () => {
    const live = new LiveRooms();
    live.seed('r', 'h', 'PLAYING', 0);
    live.sync('r', 'PAUSED', 10, 0);
    expect(live.inactivityStep('r', HOST_PAUSE_WARN_MS - 1)).toBeNull();
    expect(live.inactivityStep('r', HOST_PAUSE_WARN_MS)).toBe('WARN_HOST');
    expect(live.inactivityStep('r', HOST_PAUSE_WARN_MS + 5)).toBeNull();
    expect(live.inactivityStep('r', HOST_VOTE_OPEN_MS)).toBe('OPEN_VOTE');
  });

  it('transfers on a majority of the non-Host members, never on the Host vote', () => {
    const live = new LiveRooms();
    live.seed('r', 'h', 'PLAYING', 0);
    live.sync('r', 'PAUSED', 0, 0);
    expect(live.vote('r', 'a', 3)).toBe(false); // vote not open yet
    live.inactivityStep('r', HOST_VOTE_OPEN_MS);
    expect(live.vote('r', 'h', 3)).toBe(false);
    expect(live.vote('r', 'a', 3)).toBe(false);
    expect(live.vote('r', 'b', 3)).toBe(true);
  });

  it('a Play from the Host closes the vote', () => {
    const live = new LiveRooms();
    live.seed('r', 'h', 'PAUSED', 0);
    live.sync('r', 'PAUSED', 0, 0);
    live.inactivityStep('r', HOST_VOTE_OPEN_MS);
    live.sync('r', 'PLAYING', 0, HOST_VOTE_OPEN_MS + 1);
    expect(live.vote('r', 'a', 1)).toBe(false);
  });
});

describe('PlaybackThrottle (edge 2.3)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends the first seek at once and only the last one of a burst at the window end', () => {
    const throttle = new PlaybackThrottle();
    const sent: unknown[] = [];
    const now = Date.now();
    throttle.offer('r', 1, (p) => sent.push(p), now);
    throttle.offer('r', 2, (p) => sent.push(p), now + 100);
    throttle.offer('r', 3, (p) => sent.push(p), now + 200);
    expect(sent).toEqual([1]);
    jest.advanceTimersByTime(500);
    expect(sent).toEqual([1, 3]);
  });
});
