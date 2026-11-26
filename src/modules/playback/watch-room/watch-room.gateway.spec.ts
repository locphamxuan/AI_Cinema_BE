import type { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { RoomCluster } from './room-cluster';
import { ROOM_EVENT } from './room-events';
import type { RoomInviteService } from './room-invite.service';
import type { RoomTerminationService } from './room-termination.service';
import { WatchRoomGateway } from './watch-room.gateway';
import type { WatchRoomService } from './watch-room.service';

const ROOM = '0f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33';
const FRIEND = '1f9c8e2a-2f1b-4a53-9d4f-6f0b6a1d2c33';

function setup() {
  const rooms = { join: jest.fn(), hostSync: jest.fn(), leave: jest.fn() };
  const invites = { invite: jest.fn() };
  const cluster = new RoomCluster({ redisUrl: null } as unknown as AppConfig);
  jest.spyOn(cluster, 'isOnline').mockResolvedValue(false);
  const gateway = new WatchRoomGateway(
    { roomParticipant: { count: jest.fn() } } as unknown as PrismaService,
    rooms as unknown as WatchRoomService,
    invites as unknown as RoomInviteService,
    {} as RoomTerminationService,
    {} as JwtService,
    {} as AppConfig,
    cluster,
  );
  const roomEmit = jest.fn();
  gateway.server = { to: jest.fn(() => ({ emit: roomEmit })) } as unknown as Server;
  const emit = jest.fn();
  const client = { id: 's1', data: { userId: 'u1' }, emit, join: jest.fn(), leave: jest.fn() } as unknown as Socket;
  return { gateway, rooms, invites, cluster, client, emit, roomEmit };
}

describe('WatchRoomGateway payload and seat checks', () => {
  it('answers INVALID_PAYLOAD to a malformed room id instead of reaching the database', async () => {
    const { gateway, rooms, client, emit } = setup();
    await gateway.onJoin(client, { roomId: 'r1' });
    await gateway.onLeave(client, null);
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.ERROR, { reason: 'INVALID_PAYLOAD' });
    expect(rooms.join).not.toHaveBeenCalled();
    expect(rooms.leave).not.toHaveBeenCalled();
  });

  it('never broadcasts a Host clock that is not a finite position', async () => {
    const { gateway, rooms, client, emit, roomEmit } = setup();
    await gateway.onPlayback(client, { roomId: ROOM, state: 'PLAYING', positionSeconds: 'NaN' });
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.ERROR, { reason: 'INVALID_PAYLOAD' });
    expect(rooms.hostSync).not.toHaveBeenCalled();
    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('lets only a member seated in the room invite a friend to it', async () => {
    const { gateway, invites, cluster, client, emit } = setup();
    await gateway.onInvite(client, { roomId: ROOM, friendId: FRIEND });
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.ERROR, { reason: 'NOT_IN_ROOM' });
    expect(invites.invite).not.toHaveBeenCalled();

    cluster.seats.connect('u1', client);
    cluster.seats.take(ROOM, 'u1', client);
    invites.invite.mockResolvedValue({ ok: false, reason: 'NOT_FRIENDS' });
    await gateway.onInvite(client, { roomId: ROOM, friendId: FRIEND });
    expect(invites.invite).toHaveBeenCalledWith('u1', ROOM, FRIEND, false);
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.INVITE_FAILED, { ok: false, reason: 'NOT_FRIENDS' });
  });

  it('refuses an invite to oneself as a malformed payload', async () => {
    const { gateway, invites, client, emit } = setup();
    await gateway.onInvite(client, { roomId: ROOM, friendId: 'u1' });
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.ERROR, { reason: 'INVALID_PAYLOAD' });
    expect(invites.invite).not.toHaveBeenCalled();
  });
});
