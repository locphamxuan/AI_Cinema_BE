import type { FriendshipService } from 'src/modules/episode-access/access-decision/friendship.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { RoomInviteService } from './room-invite.service';
import { RoomSeats } from './room-seats';
import { handshakeTokenOf, liveStateOf, socketErrorOf } from './room-socket-utils';

describe('RoomInviteService (edges 7.1–7.3)', () => {
  const friendships = { acceptedFriends: jest.fn() };
  const notifications = { notify: jest.fn() };
  const newService = () =>
    new RoomInviteService(friendships as unknown as FriendshipService, notifications as unknown as NotificationService);

  beforeEach(() => {
    jest.clearAllMocks();
    friendships.acceptedFriends.mockResolvedValue([{ id: 'f1', fullName: 'Bạn' }]);
  });

  it('delivers to an online friend on the socket, with a 10 minute expiry', async () => {
    const res = await newService().invite('u1', 'r1', 'f1', true, 0);
    expect(res).toEqual({
      ok: true,
      deliver: 'SOCKET',
      invite: { roomId: 'r1', invitedBy: 'u1', expiresAt: 10 * 60 * 1000 },
    });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('notifies an offline friend instead (edge 7.2)', async () => {
    const res = await newService().invite('u1', 'r1', 'f1', false, 0);
    expect(res).toMatchObject({ ok: true, deliver: 'NOTIFICATION' });
    expect(notifications.notify).toHaveBeenCalledWith(['f1'], expect.objectContaining({ type: 'ROOM_INVITE' }));
  });

  it('refuses a second invite to the same friend inside 60 s (edge 7.1)', async () => {
    const service = newService();
    await service.invite('u1', 'r1', 'f1', true, 0);
    await expect(service.invite('u1', 'r1', 'f1', true, 1_000)).resolves.toEqual({
      ok: false,
      reason: 'COOLDOWN',
      retryAfterSeconds: 59,
    });
    await expect(service.invite('u1', 'r1', 'f1', true, 60_000)).resolves.toMatchObject({ ok: true });
  });

  it('refuses anyone who is not an accepted friend, blocked pairs included (edge 7.3)', async () => {
    friendships.acceptedFriends.mockResolvedValue([]);
    await expect(newService().invite('u1', 'r1', 'stranger', true, 0)).resolves.toEqual({
      ok: false,
      reason: 'NOT_FRIENDS',
    });
  });
});

describe('RoomSeats (edge 5.2)', () => {
  it('gives the seat to the newest device and hands back the one it displaced', () => {
    const seats = new RoomSeats<{ id: string }>();
    const phone = { id: 's1' };
    const tablet = { id: 's2' };
    seats.connect('u', phone);
    seats.connect('u', tablet);
    expect(seats.take('r', 'u', phone)).toBeUndefined();
    expect(seats.take('r', 'u', tablet)).toBe(phone);
    // The displaced device dropping no longer counts as the member leaving.
    expect(seats.disconnect('u', 's1', 'r')).toBe(false);
    expect(seats.isOnline('u')).toBe(true);
    expect(seats.disconnect('u', 's2', 'r')).toBe(true);
    expect(seats.isOnline('u')).toBe(false);
  });
});

describe('room socket utils', () => {
  it('reads the token from auth, then from the bearer header', () => {
    expect(handshakeTokenOf({ handshake: { auth: { token: 't1' }, headers: {} } })).toBe('t1');
    expect(handshakeTokenOf({ handshake: { auth: {}, headers: { authorization: 'Bearer t2' } } })).toBe('t2');
    expect(handshakeTokenOf({ handshake: { auth: {}, headers: {} } })).toBe('');
  });

  it('maps statuses and errors for the socket', () => {
    expect(liveStateOf('PLAYING')).toBe('PLAYING');
    expect(liveStateOf('CREATED')).toBe('PAUSED');
    expect(socketErrorOf({ getResponse: () => ({ message: 'Phòng đầy', details: { reason: 'ROOM_FULL' } }) })).toEqual({
      reason: 'Phòng đầy',
      details: { reason: 'ROOM_FULL' },
    });
    expect(socketErrorOf(new Error('boom'))).toEqual({ reason: 'boom' });
  });
});
