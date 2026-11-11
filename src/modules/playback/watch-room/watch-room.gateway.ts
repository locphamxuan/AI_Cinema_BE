import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WatchRoomService } from './watch-room.service';
import { FriendshipService } from 'src/modules/episode-access/access-decision/friendship.service';
import { WatchEntitlementService } from 'src/modules/episode-access/access-decision/watch-entitlement.service';

/** Room channel = `room:<roomId>`; the Host sends a sync, everyone in the room receives it. */
const ROOM_CHANNEL = (roomId: string) => `room:${roomId}`;

/** 45 s of Host silence and the room is taken over by the next participant (BR-69). */
const HOST_SILENCE_MS = 45_000;

@WebSocketGateway({
  namespace: 'watch',
  cors: { origin: '*', credentials: true },
  transports: ['websocket'],
})
export class WatchRoomGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(WatchRoomGateway.name);
  private readonly roomTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: WatchRoomService,
    private readonly friendships: FriendshipService,
    private readonly entitlement: WatchEntitlementService,
  ) {}

  handleConnection(client: Socket): void {
    const userId = (client.handshake.auth as { userId?: string })?.userId;
    if (!userId) {
      client.disconnect(true);
      return;
    }
    (client.data as { userId: string }).userId = userId;
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as { userId?: string; roomId?: string };
    if (data.roomId) void this.onHostSilent(data.roomId);
  }

  /** Member joins a room: entitlement is checked before the client is admitted (BR-69). */
  @SubscribeMessage('ROOM_JOIN')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }): Promise<void> {
    const userId = (client.data as { userId: string }).userId;
    try {
      const room = await this.rooms.join(userId, body.roomId);
      const check = await this.entitlement.canWatch(room.episodeId, userId);
      if (!check.allowed) {
        this.server.to(client.id).emit('ROOM_ERROR', { reason: check.reason ?? 'ENTITLEMENT_REQUIRED' });
        return;
      }
      void client.join(ROOM_CHANNEL(body.roomId));
      (client.data as { roomId: string }).roomId = body.roomId;
      this.server
        .to(ROOM_CHANNEL(body.roomId))
        .emit('ROOM_PARTICIPANT_JOINED', { userId, count: room.participantCount });
      this.server.to(client.id).emit('ROOM_JOINED', { room });
    } catch (e) {
      this.server.to(client.id).emit('ROOM_ERROR', { reason: (e as Error).message });
    }
  }

  /** Host-driven sync: PLAY / PAUSE / SEEK. Participants drift-correct on the client. */
  @SubscribeMessage('ROOM_PLAYBACK')
  async onPlayback(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; state: 'PLAYING' | 'PAUSED'; positionSeconds: number },
  ): Promise<void> {
    const userId = (client.data as { userId: string }).userId;
    try {
      await this.rooms.hostSync(userId, body.roomId, { state: body.state, positionSeconds: body.positionSeconds });
      this.server.to(ROOM_CHANNEL(body.roomId)).emit('SYNC_PLAYBACK', {
        state: body.state,
        positionSeconds: body.positionSeconds,
        hostUserId: userId,
        sentAt: Date.now(),
      });
      this.resetHostTimer(body.roomId);
    } catch (e) {
      this.server.to(client.id).emit('ROOM_ERROR', { reason: (e as Error).message });
    }
  }

  /** Invite an accepted friend into the room (60 s cooldown, BR-69). */
  @SubscribeMessage('ROOM_INVITE')
  async onInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; friendId: string },
  ): Promise<void> {
    const userId = (client.data as { userId: string }).userId;
    const friend = await this.prisma.user.findUnique({ where: { id: body.friendId } });
    if (!friend) {
      this.server.to(client.id).emit('ROOM_ERROR', { reason: 'Friend not found' });
      return;
    }
    const online = this.server.sockets.sockets.has(body.friendId);
    if (!online) {
      this.server.to(client.id).emit('ROOM_INVITE_FAILED', { reason: 'Friend is offline' });
      return;
    }
    this.server.to(body.friendId).emit('ROOM_INVITED', {
      roomId: body.roomId,
      invitedBy: userId,
      sentAt: Date.now(),
    });
  }

  private resetHostTimer(roomId: string): void {
    this.clearHostTimer(roomId);
    this.roomTimers.set(
      roomId,
      setTimeout(() => {
        void this.onHostSilent(roomId);
      }, HOST_SILENCE_MS),
    );
  }

  private clearHostTimer(roomId: string): void {
    const t = this.roomTimers.get(roomId);
    if (t) clearTimeout(t);
    this.roomTimers.delete(roomId);
  }

  private async onHostSilent(roomId: string): Promise<void> {
    const room = await this.prisma.watchRoom.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    if (!room || room.status === 'DISBANDED') return;
    const hosts = room.participants.filter((p) => p.role === 'HOST' && !p.leftAt);
    if (hosts.length === 0) return;
    this.server.to(ROOM_CHANNEL(roomId)).emit('SYNC_HOST_LOST', { roomId, reason: 'HOST_SILENT' });
  }
}
