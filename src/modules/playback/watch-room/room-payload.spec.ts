import { MAX_POSITION_SECONDS } from 'src/modules/playback/watch-progress/dto/position-limit';
import { inviteOf, optionalUuid, playbackOf, roomIdOf } from './room-payload';

const ROOM = '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33';
const FRIEND = '1f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33';

describe('room socket payloads', () => {
  it('reads a room id only when it is a UUID', () => {
    expect(roomIdOf({ roomId: ROOM })).toBe(ROOM);
    for (const bad of [null, undefined, 'x', 42, [], { roomId: 'r1' }, { roomId: 7 }]) {
      expect(roomIdOf(bad)).toBeNull();
    }
  });

  it('accepts a Host clock with fractions but never NaN, negative, too large or an unknown state', () => {
    expect(playbackOf({ roomId: ROOM, state: 'PLAYING', positionSeconds: 12.5 })).toEqual({
      roomId: ROOM,
      state: 'PLAYING',
      positionSeconds: 12.5,
    });
    for (const positionSeconds of [Number.NaN, -1, MAX_POSITION_SECONDS + 1, '12', Infinity]) {
      expect(playbackOf({ roomId: ROOM, state: 'PAUSED', positionSeconds })).toBeNull();
    }
    expect(playbackOf({ roomId: ROOM, state: 'DISBANDED', positionSeconds: 1 })).toBeNull();
  });

  it('reads an invite to a friend, never to oneself or a malformed id', () => {
    expect(inviteOf({ roomId: ROOM, friendId: FRIEND }, 'me')).toEqual({ roomId: ROOM, friendId: FRIEND });
    expect(inviteOf({ roomId: ROOM, friendId: FRIEND }, FRIEND)).toBeNull();
    expect(inviteOf({ roomId: ROOM, friendId: 'f1' }, 'me')).toBeNull();
  });

  it('takes an absent ad break id or a UUID', () => {
    expect(optionalUuid(undefined)).toBe(true);
    expect(optionalUuid(FRIEND)).toBe(true);
    expect(optionalUuid('b1')).toBe(false);
  });
});
