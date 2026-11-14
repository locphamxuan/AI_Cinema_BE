import { Inject, OnModuleDestroy, OnModuleInit, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { type AccessTokenPayload, JWT_ALGORITHM } from 'src/common/auth/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { RoomInviteService } from './room-invite.service';
import { LiveRooms, PlaybackThrottle } from './room-live-state';
import { RoomSeats } from './room-seats';
import { handshakeTokenOf, liveStateOf, socketErrorOf, assertActiveAccount } from './room-socket-utils';
import { SignedInSocketGuard } from './room-socket.guard';
import { RoomTerminationService } from './room-termination.service';
import { WatchRoomService } from './watch-room.service';
import {
  HEARTBEAT_MS,
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
export class WatchRoomGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly live = new LiveRooms();
  private readonly throttle = new PlaybackThrottle();
  private readonly seats = new RoomSeats<Socket>();
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: WatchRoomService,
    private readonly invites: RoomInviteService,
    private readonly termination: RoomTerminationService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.termination.register((roomIds, reason) => this.broadcastTermination(roomIds, reason));
    this.heartbeat = setInterval(() => void this.onHeartbeat(), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
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
    if (this.seats.disconnect(userId, client.id, roomId)) void this.onMemberDrop(roomId!, userId!);
  }

  @SubscribeMessage(ROOM_EVENT.JOIN)
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }): Promise<void> {
    const userId = (client.data as SocketData).userId!;
    try {
      const room = await this.rooms.join(userId, body.roomId);
      this.takeSeat(body.roomId, userId, client);
      this.live.seed(body.roomId, room.hostUserId, liveStateOf(room.status), room.currentPositionSeconds);
      if (room.hostUserId === userId) this.cancelGrace(body.roomId, true);
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
      this.throttle.offer(body.roomId, payload, (p) =>
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
    if (!this.live.vote(body.roomId, userId, active)) return;
    const newHost = await this.rooms.promoteNextHost(body.roomId);
    if (!newHost) return;
    this.live.setHost(body.roomId, newHost);
    this.server.to(ROOM_CHANNEL(body.roomId)).emit(ROOM_EVENT.HOST_CHANGED, { newHostUserId: newHost, reason: 'VOTE' });
  }

  /** Edges 7.1–7.3 — invite an accepted friend: 60 s cooldown, 10 min TTL, offline → notification. */
  @SubscribeMessage(ROOM_EVENT.INVITE)
  async onInvite(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; friendId: string },
  ): Promise<void> {
    const userId = (client.data as SocketData).userId!;
    const outcome = await this.invites.invite(userId, body.roomId, body.friendId, this.seats.isOnline(body.friendId));
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
  }

  /** A socket vanished mid-room: the Host gets the 45 s grace (edge 3.1), a member just leaves. */
  private async onMemberDrop(roomId: string, userId: string): Promise<void> {
    const liveRoom = this.live.get(roomId);
    if (liveRoom?.hostUserId === userId) {
      this.live.sync(roomId, 'PAUSED', this.live.positionNow(roomId) ?? 0);
      await this.prisma.watchRoom.update({ where: { id: roomId }, data: { status: 'PAUSED' } }).catch(() => undefined);
      this.server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.HOST_DISCONNECTED, {
        graceSeconds: HOST_GRACE_MS / 1000,
        message: 'Trưởng phòng bị mất kết nối, đang chờ kết nối lại (45s)...',
      });
      this.cancelGrace(roomId, false);
      const timer = setTimeout(() => void this.onGraceExpired(roomId, userId), HOST_GRACE_MS);
      timer.unref?.();
      this.graceTimers.set(roomId, timer);
      return;
    }
    this.server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.PARTICIPANT_LEFT, { userId });
    await this.notifyWhenAlone(roomId);
  }

  private async onGraceExpired(roomId: string, hostUserId: string): Promise<void> {
    this.graceTimers.delete(roomId);
    if (this.seats.isSeated(roomId, hostUserId)) return; // the Host made it back
    const newHost = await this.rooms.promoteNextHost(roomId);
    if (newHost) {
      this.live.setHost(roomId, newHost);
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
      this.live.setHost(roomId, result.newHostUserId);
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

  /** The 5 s pulse: HEARTBEAT_SYNC for drift (edge 2.2) and the pause-too-long ladder (edge 3.3). */
  private async onHeartbeat(): Promise<void> {
    for (const roomId of this.live.roomIds()) {
      const sockets = await this.server.in(ROOM_CHANNEL(roomId)).fetchSockets();
      if (!sockets.length) {
        this.live.drop(roomId);
        this.throttle.clear(roomId);
        continue;
      }
      const room = this.live.get(roomId)!;
      this.server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.HEARTBEAT_SYNC, {
        state: room.state,
        positionSeconds: this.live.positionNow(roomId),
        serverTimestamp: Date.now(),
      });
      const step = this.live.inactivityStep(roomId);
      if (step === 'WARN_HOST' && room.hostUserId) {
        this.server.to(USER_CHANNEL(room.hostUserId)).emit(ROOM_EVENT.HOST_INACTIVE, { roomId });
      } else if (step === 'OPEN_VOTE') {
        this.server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.VOTE_OPEN, { roomId });
      }
    }
  }

  private broadcastTermination(roomIds: string[], reason: string): void {
    for (const roomId of roomIds) {
      this.server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.TERMINATED, { roomId, reason });
      this.live.drop(roomId);
      this.throttle.clear(roomId);
      this.cancelGrace(roomId, false);
    }
  }

  private cancelGrace(roomId: string, announce: boolean): void {
    const timer = this.graceTimers.get(roomId);
    if (!timer) return;
    clearTimeout(timer);
    this.graceTimers.delete(roomId);
    if (announce) this.server.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.HOST_RECONNECTED, { roomId });
  }
}
