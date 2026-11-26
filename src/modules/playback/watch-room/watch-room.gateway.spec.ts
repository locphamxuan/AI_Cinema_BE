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
  const rooms = { join: jest.fn(), hostSync: jest.fn(), leave: jest.fn(), assertCanUse: jest.fn() };
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
  rooms.assertCanUse.mockResolvedValue(undefined);
  const roomEmit = jest.fn();
  gateway.server = { to: jest.fn(() => ({ emit: roomEmit })) } as unknown as Server;
  const emit = jest.fn();
  const leave = jest.fn();
  const client = { id: 's1', data: { userId: 'u1' }, emit, join: jest.fn(), leave } as unknown as Socket;
  const server = gateway.server;
  return { gateway, rooms, invites, cluster, client, emit, roomEmit, server, leave };
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

  it('updates live host state and detaches the leaver after a REST hand-over', async () => {
    const { gateway, cluster, roomEmit, server } = setup();
    const leaveOldSocket = jest.fn().mockResolvedValue(undefined);
    const leaveSocket = {
      id: 's1',
      data: { userId: 'u1', roomId: ROOM },
      leave: leaveOldSocket,
      emit: jest.fn(),
    } as unknown as Socket;
    const memberSocket = {
      id: 's2',
      data: { userId: 'u2', roomId: ROOM },
      leave: jest.fn(),
      emit: jest.fn(),
    } as unknown as Socket;
    const fetchSockets = jest
      .fn()
      .mockResolvedValueOnce([leaveSocket, memberSocket])
      .mockResolvedValueOnce([memberSocket]);
    (server as unknown as { in: jest.Mock }).in = jest.fn(() => ({ fetchSockets }));
    cluster.live.seed(ROOM, 'u1', 'PAUSED', 0);
    cluster.seats.connect('u1', leaveSocket);
    cluster.seats.take(ROOM, 'u1', leaveSocket);

    await gateway.afterRestLeave(ROOM, 'u1', { closed: false, newHostUserId: 'u2' });

    expect(cluster.live.get(ROOM)?.hostUserId).toBe('u2');
    expect(leaveOldSocket).toHaveBeenCalledWith(`room:${ROOM}`);
    expect(cluster.seats.isSeated(ROOM, 'u1')).toBe(false);
    expect(roomEmit).toHaveBeenCalledWith(ROOM_EVENT.HOST_CHANGED, { newHostUserId: 'u2', reason: 'HOST_LEFT' });
  });

  it('keeps the socket seated when the leave transaction fails', async () => {
    const { gateway, rooms, cluster, client, emit, leave } = setup();
    rooms.leave.mockRejectedValue(new Error('database unavailable'));
    cluster.seats.connect('u1', client);
    cluster.seats.take(ROOM, 'u1', client);
    (client.data as { roomId?: string }).roomId = ROOM;

    await gateway.onLeave(client, { roomId: ROOM });

    expect(cluster.seats.isSeated(ROOM, 'u1')).toBe(true);
    expect(leave).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.ERROR, { reason: 'ROOM_ERROR' });
  });
});
