import { Inject, Logger, OnModuleInit, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Server, Socket } from 'socket.io';
import { type AccessTokenPayload, JWT_ALGORITHM } from 'src/common/auth/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { RoomInviteService } from './room-invite.service';
import { RoomCluster } from './room-cluster';
import { handshakeTokenOf, liveStateOf, socketErrorOf, assertActiveAccount } from './room-socket-utils';
import { SignedInSocketGuard } from './room-socket.guard';
import { RoomTerminationService } from './room-termination.service';
import { WatchRoomService } from './watch-room.service';
import {
  HOST_GRACE_MS,
  INVITE_COOLDOWN_MS,
  ROOM_CHANNEL,
  ROOM_EVENT,
  ROOM_TERMINATED_REASON,
  USER_CHANNEL,
} from './room-events';

type SocketData = { userId?: string; roomId?: string };

/**
 * Watch Party gateway (BR-69): the Host drives, everyone follows. Handshake = access JWT; one seat
 * per member per room (5.2); 5 s heartbeat (2.2); 45 s Host grace (3.1); pause → vote (3.3).
 */
@WebSocketGateway({ namespace: 'watch', cors: { origin: '*', credentials: true }, transports: ['websocket'] })
@UseGuards(SignedInSocketGuard)
export class WatchRoomGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(WatchRoomGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: WatchRoomService,
    private readonly invites: RoomInviteService,
    private readonly termination: RoomTerminationService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly cluster: RoomCluster,
  ) {}

  private get live() {
    return this.cluster.live;
  }

  private get seats() {
    return this.cluster.seats;
  }

  afterInit(server: Server): void {
    this.cluster.attach(server as unknown as Namespace);
  }

  onModuleInit(): void {
    this.termination.register((roomIds, reason) => this.broadcastTermination(roomIds, reason));
  }

  /** The socket is admitted only with a valid access token; the member id comes from it alone. */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(handshakeTokenOf(client), {
        algorithms: [JWT_ALGORITHM],
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
      });
      if (payload.type !== 'access') throw new Error('not an access token');
      await assertActiveAccount(this.prisma, payload.sub);
      (client.data as SocketData).userId = payload.sub;
      this.seats.connect(payload.sub, client);
      void client.join(USER_CHANNEL(payload.sub));
    } catch {
      client.emit(ROOM_EVENT.ERROR, { reason: 'UNAUTHENTICATED' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const { userId, roomId } = client.data as SocketData;
    if (!this.seats.disconnect(userId, client.id, roomId)) return;
    // A drop during shutdown may find the Redis adapter already closed: never leave the rejection unhandled.
    this.onMemberDrop(roomId!, userId!).catch((e: unknown) =>
      this.logger.warn(`Drop of ${userId} not handled: ${String(e)}`),
    );
  }

  @SubscribeMessage(ROOM_EVENT.JOIN)
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }): Promise<void> {
    const userId = (client.data as SocketData).userId!;
    try {
      const room = await this.rooms.join(userId, body.roomId);
      this.takeSeat(body.roomId, userId, client);
      this.live.seed(body.roomId, room.hostUserId, liveStateOf(room.status), room.currentPositionSeconds);
      if (room.hostUserId === userId) {
        this.cluster.cancelGrace(body.roomId, true);
        this.cluster.publish({ t: 'hostBack', roomId: body.roomId });
      }
      this.server
        .to(ROOM_CHANNEL(body.roomId))
        .emit(ROOM_EVENT.PARTICIPANT_JOINED, { userId, count: room.participantCount });
      client.emit(ROOM_EVENT.JOINED, { room });
    } catch (e) {
      client.emit(ROOM_EVENT.ERROR, socketErrorOf(e));
    }
  }

  @SubscribeMessage(ROOM_EVENT.PLAYBACK)
  async onPlayback(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; state: 'PLAYING' | 'PAUSED' | 'ENDED'; positionSeconds: number },
  ): Promise<void> {
    const userId = (client.data as SocketData).userId!;
    try {
      await this.rooms.hostSync(userId, body.roomId, { state: body.state, positionSeconds: body.positionSeconds });
      this.live.sync(body.roomId, body.state, body.positionSeconds);
      this.cluster.publish({
        t: 'sync',
        roomId: body.roomId,
        state: body.state,
        positionSeconds: body.positionSeconds,
      });
      if (body.state === 'ENDED') {
        // Edge 3.5 — credits roll: the room sees the countdown; only the Host may continue.
        this.server.to(ROOM_CHANNEL(body.roomId)).emit(ROOM_EVENT.EPISODE_ENDED, { countdownSeconds: 10 });
        return;
      }
      const payload = {
        state: body.state,
        positionSeconds: body.positionSeconds,
        hostUserId: userId,
        serverTimestamp: Date.now(),
      };
      this.cluster.throttle.offer(body.roomId, payload, (p) =>
        this.server.to(ROOM_CHANNEL(body.roomId)).emit(ROOM_EVENT.SYNC_PLAYBACK, p),
      );
    } catch (e) {
      client.emit(ROOM_EVENT.ERROR, socketErrorOf(e));
    }
  }

  @SubscribeMessage(ROOM_EVENT.LEAVE)
  async onLeave(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }): Promise<void> {
    const userId = (client.data as SocketData).userId!;
    this.seats.release(body.roomId, userId);
    void client.leave(ROOM_CHANNEL(body.roomId));
    (client.data as SocketData).roomId = undefined;
    try {
      const result = await this.rooms.leave(userId, body.roomId, {});
      await this.afterMemberLeft(body.roomId, userId, result);
    } catch (e) {
      client.emit(ROOM_EVENT.ERROR, socketErrorOf(e));
    }
  }

  /** Edge 3.3 — a member votes to move the Host seat while the vote is open. */
  @SubscribeMessage(ROOM_EVENT.VOTE_HOST)
  async onVoteHost(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }): Promise<void> {
    const userId = (client.data as SocketData).userId!;
    if (!this.seats.isSeated(body.roomId, userId)) return void client.emit(ROOM_EVENT.ERROR, { reason: 'NOT_IN_ROOM' });
    const active = await this.prisma.roomParticipant.count({
      where: { roomId: body.roomId, leftAt: null, role: 'PARTICIPANT' },
    });
    const carried = this.live.vote(body.roomId, userId, active);
    this.cluster.publish({ t: 'vote', roomId: body.roomId, userId });
    if (!carried) return;
    const newHost = await this.rooms.promoteNextHost(body.roomId);
    if (!newHost) return;
    this.handOver(body.roomId, newHost);
    this.server.to(ROOM_CHANNEL(body.roomId)).emit(ROOM_EVENT.HOST_CHANGED, { newHostUserId: newHost, reason: 'VOTE' });
  }

  /** Edges 7.1–7.3 — invite an accepted friend: 60 s cooldown, 10 min TTL, offline → notification. */
  @SubscribeMessage(ROOM_EVENT.INVITE)
  async onInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; friendId: string },
  ): Promise<void> {
    const userId = (client.data as SocketData).userId!;
    const outcome = await this.invites.invite(
      userId,
      body.roomId,
      body.friendId,
      await this.cluster.isOnline(body.friendId),
    );
    if (!outcome.ok) {
      client.emit(ROOM_EVENT.INVITE_FAILED, outcome);
      return;
    }
    if (outcome.deliver === 'SOCKET')
      this.server.to(USER_CHANNEL(body.friendId)).emit(ROOM_EVENT.INVITED, outcome.invite);
    client.emit(ROOM_EVENT.INVITE_SENT, { friendId: body.friendId, cooldownSeconds: INVITE_COOLDOWN_MS / 1000 });
  }

  /** One member, one seat per room (edge 5.2): the older socket is told and unseated. */
  private takeSeat(roomId: string, userId: string, client: Socket): void {
    const old = this.seats.take(roomId, userId, client);
    if (old) {
      old.emit(ROOM_EVENT.SESSION_REPLACED, { roomId, reason: 'Bạn đã tham gia phòng này từ một thiết bị khác' });
      void old.leave(ROOM_CHANNEL(roomId));
      (old.data as SocketData).roomId = undefined;
    }
    void client.join(ROOM_CHANNEL(roomId));
    (client.data as SocketData).roomId = roomId;
    this.cluster.publish({ t: 'unseat', roomId, userId, keepSocketId: client.id });
  }

  /** A socket vanished mid-room: the Host gets the 45 s grace (edge 3.1), a member just leaves. */
  private async onMemberDrop(roomId: string, userId: string): Promise<void> {
    const liveRoom = this.live.get(roomId);
    if (liveRoom?.hostUserId === userId) {
      const positionSeconds = this.live.positionNow(roomId) ?? 0;
      this.live.sync(roomId, 'PAUSED', positionSeconds);
      this.cluster.publish({ t: 'sync', roomId, state: 'PAUSED', positionSeconds });
      await this.prisma.watchRoom.update({ where: { id: roomId }, data: { status: 'PAUSED' } }).catch(() => undefined);
      this.server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.HOST_DISCONNECTED, {
        graceSeconds: HOST_GRACE_MS / 1000,
        message: 'Trưởng phòng bị mất kết nối, đang chờ kết nối lại (45s)...',
      });
      this.cluster.startGrace(roomId, HOST_GRACE_MS, () => void this.onGraceExpired(roomId, userId));
      return;
    }
    this.server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.PARTICIPANT_LEFT, { userId });
    await this.notifyWhenAlone(roomId);
  }

  private async onGraceExpired(roomId: string, hostUserId: string): Promise<void> {
    if (await this.cluster.isSeated(roomId, hostUserId)) return; // the Host made it back, on any instance
    const newHost = await this.rooms.promoteNextHost(roomId);
    if (newHost) {
      this.handOver(roomId, newHost);
      this.server
        .to(ROOM_CHANNEL(roomId))
        .emit(ROOM_EVENT.HOST_CHANGED, { newHostUserId: newHost, reason: 'HOST_TIMEOUT' });
      return;
    }
    await this.rooms.close(roomId);
    this.broadcastTermination([roomId], ROOM_TERMINATED_REASON.HOST_LEFT);
  }

  private async afterMemberLeft(
    roomId: string,
    userId: string,
    result: { closed: boolean; newHostUserId: string | null },
  ): Promise<void> {
    if (result.closed) {
      this.broadcastTermination([roomId], ROOM_TERMINATED_REASON.HOST_DISBANDED);
      return;
    }
    this.server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.PARTICIPANT_LEFT, { userId });
    if (result.newHostUserId) {
      this.handOver(roomId, result.newHostUserId);
      this.server
        .to(ROOM_CHANNEL(roomId))
        .emit(ROOM_EVENT.HOST_CHANGED, { newHostUserId: result.newHostUserId, reason: 'HOST_LEFT' });
    }
    await this.notifyWhenAlone(roomId);
  }

  /** Edge 3.4 — one member left alone is offered the way back to solo playback. */
  private async notifyWhenAlone(roomId: string): Promise<void> {
    const sockets = await this.server.in(ROOM_CHANNEL(roomId)).fetchSockets();
    if (sockets.length === 1) {
      sockets[0].emit(ROOM_EVENT.LAST_ONE_LEFT, {
        message: 'Các bạn khác đã rời phòng. Bạn có muốn chuyển về chế độ xem cá nhân không?',
      });
    }
  }

  private broadcastTermination(roomIds: string[], reason: string): void {
    for (const roomId of roomIds) {
      this.server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.TERMINATED, { roomId, reason });
      this.cluster.forget(roomId);
      this.cluster.publish({ t: 'drop', roomId });
    }
  }

  private handOver(roomId: string, hostUserId: string | null): void {
    this.live.setHost(roomId, hostUserId);
    this.cluster.publish({ t: 'host', roomId, hostUserId });
  }
}
