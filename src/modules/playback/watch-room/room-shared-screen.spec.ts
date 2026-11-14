import {
  CHAT_BURST_LIMIT,
  CHAT_BURST_WINDOW_MS,
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_LENGTH,
  isChatRejection,
  ROOM_STATE_TTL_MS,
  RoomSharedScreen,
} from './room-shared-screen';

const AUTHOR = { userId: 'u1', fullName: 'An' };

describe('RoomSharedScreen', () => {
  it('starts every room on auto quality, no ad and an empty chat', () => {
    expect(new RoomSharedScreen().snapshot('r1')).toEqual({ quality: 'auto', ad: { active: false }, chat: [] });
  });

  it('stores trimmed chat lines and refuses empty or too long ones', () => {
    const screen = new RoomSharedScreen();
    const message = screen.chat('r1', AUTHOR, '  xin   chào  ', 1_000);
    expect(isChatRejection(message)).toBe(false);
    expect(message).toMatchObject({ userId: 'u1', fullName: 'An', text: 'xin chào', sentAt: 1_000 });
    expect(screen.chat('r1', AUTHOR, '   ')).toBe('EMPTY');
    expect(screen.chat('r1', AUTHOR, 42)).toBe('EMPTY');
    expect(screen.chat('r1', AUTHOR, 'x'.repeat(CHAT_MAX_LENGTH + 1))).toBe('TOO_LONG');
    expect(screen.snapshot('r1').chat).toHaveLength(1);
  });

  it('rate-limits a member who floods the chat, and lets them talk again after the window', () => {
    const screen = new RoomSharedScreen();
    for (let i = 0; i < CHAT_BURST_LIMIT; i++)
      expect(isChatRejection(screen.chat('r1', AUTHOR, `m${i}`, 1_000 + i))).toBe(false);
    expect(screen.chat('r1', AUTHOR, 'spam', 1_100)).toBe('RATE_LIMITED');
    expect(isChatRejection(screen.chat('r1', { userId: 'u2', fullName: 'Bình' }, 'hi', 1_100))).toBe(false);
    expect(isChatRejection(screen.chat('r1', AUTHOR, 'again', 1_000 + CHAT_BURST_WINDOW_MS + 10))).toBe(false);
  });

  it('keeps only the latest lines', () => {
    const screen = new RoomSharedScreen();
    for (let i = 0; i < CHAT_HISTORY_LIMIT + 5; i++) screen.chat('r1', { userId: `u${i}`, fullName: 'X' }, `m${i}`, i);
    const chat = screen.snapshot('r1').chat;
    expect(chat).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(chat[0].text).toBe('m5');
  });

  it('mirrors the Host ad while it runs and clears it at the end', () => {
    const screen = new RoomSharedScreen();
    const ad = screen.setAd(
      'r1',
      { active: true, title: 'Ad', mediaUrl: 'https://cdn/ad.mp4', durationSeconds: 15 },
      500,
    );
    expect(ad).toEqual({
      active: true,
      title: 'Ad',
      mediaUrl: 'https://cdn/ad.mp4',
      durationSeconds: 15,
      startedAt: 500,
    });
    expect(screen.snapshot('r1').ad.active).toBe(true);
    expect(screen.setAd('r1', { active: false, title: 'ignored' })).toEqual({ active: false });
  });

  it('accepts only auto or a rendition name as the room quality', () => {
    const screen = new RoomSharedScreen();
    expect(screen.setQuality('r1', '720p')).toBe('720p');
    expect(screen.setQuality('r1', 'auto')).toBe('auto');
    expect(screen.setQuality('r1', 'https://evil')).toBeNull();
    expect(screen.setQuality('r1', 7)).toBeNull();
    expect(screen.snapshot('r1').quality).toBe('auto');
  });

  it('forgets rooms idle past the TTL and on demand', () => {
    const screen = new RoomSharedScreen();
    screen.setQuality('old', '480p', 0);
    screen.setQuality('new', '1080p', ROOM_STATE_TTL_MS + 1);
    expect(screen.snapshot('old').quality).toBe('auto');
    screen.forget('new');
    expect(screen.snapshot('new').quality).toBe('auto');
  });
});
