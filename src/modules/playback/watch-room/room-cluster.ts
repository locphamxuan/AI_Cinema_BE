import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Namespace, Socket } from 'socket.io';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { HEARTBEAT_MS, ROOM_CHANNEL, ROOM_EVENT, USER_CHANNEL } from './room-events';
import { LiveRooms, PlaybackThrottle, type LivePlaybackState } from './room-live-state';
import { RoomSeats } from './room-seats';
import { RoomSharedScreen, type RoomAdState, type RoomChatMessage } from './room-shared-screen';

/** A change to a room's in-memory state, mirrored to the other API instances. */
export type RoomStateOp =
  | { t: 'sync'; roomId: string; state: LivePlaybackState; positionSeconds: number }
  | { t: 'host'; roomId: string; hostUserId: string | null }
  | { t: 'vote'; roomId: string; userId: string }
  | { t: 'drop'; roomId: string }
  | { t: 'hostBack'; roomId: string }
  | { t: 'unseat'; roomId: string; userId: string; keepSocketId: string }
  | { t: 'chat'; roomId: string; message: RoomChatMessage }
  | { t: 'ad'; roomId: string; ad: RoomAdState }
  | { t: 'quality'; roomId: string; quality: string };

const STATE_EVENT = 'watch-room:state';

/**
 * The watch room state shared by both `/watch` gateways, and how it stays the same on every API
 * instance. Each instance keeps its own copy (live clock, votes, seats, shared screen); a change made
 * on one is `serverSideEmit`-ted through the Redis adapter and replayed on the others, which never
 * re-emit to clients (the instance that made the change already broadcast to the whole room). Pulses
 * (heartbeat, pause ladder) go to local sockets only, since every instance runs its own. Without Redis
 * there is one instance and nothing to mirror.
 */
@Injectable()
export class RoomCluster implements OnModuleDestroy {
  readonly live = new LiveRooms();
  readonly throttle = new PlaybackThrottle();
  readonly seats = new RoomSeats<Socket>();
  readonly screen = new RoomSharedScreen();
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly mirrored: boolean;
  private server: Namespace | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.mirrored = Boolean(config.redisUrl);
  }

  /** Both gateways call it with the same namespace; the first call wires the mirror and the pulse. */
  attach(server: Namespace): void {
    if (this.server) return;
    this.server = server;
    if (this.mirrored) server.on(STATE_EVENT, (op: RoomStateOp) => this.apply(op));
    this.heartbeat = setInterval(() => void this.pulse(), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const timer of this.graceTimers.values()) clearTimeout(timer);
  }

  /** Tells the other instances; the caller already applied the change here. */
  publish(op: RoomStateOp): void {
    if (this.mirrored && this.server) this.server.serverSideEmit(STATE_EVENT, op);
  }

  /** Online on any instance (edge 7.2: socket invite vs notification). */
  async isOnline(userId: string): Promise<boolean> {
    return (await this.server!.in(USER_CHANNEL(userId)).fetchSockets()).length > 0;
  }

  /** The member holds a seat in the room on any instance (the Host came back elsewhere, edge 3.1). */
  async isSeated(roomId: string, userId: string): Promise<boolean> {
    const sockets = await this.server!.in(ROOM_CHANNEL(roomId)).fetchSockets();
    return sockets.some((socket) => (socket.data as { userId?: string }).userId === userId);
  }

  startGrace(roomId: string, ms: number, expire: () => void): void {
    this.cancelGrace(roomId, false);
    const timer = setTimeout(() => {
      this.graceTimers.delete(roomId);
      expire();
    }, ms);
    timer.unref?.();
    this.graceTimers.set(roomId, timer);
  }

  /** Stops a Host grace running on this instance; `announce` tells the room the Host is back. */
  cancelGrace(roomId: string, announce: boolean): void {
    const timer = this.graceTimers.get(roomId);
    if (!timer) return;
    clearTimeout(timer);
    this.graceTimers.delete(roomId);
    if (announce) this.server?.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.HOST_RECONNECTED, { roomId });
  }

  /** The room is gone: every instance forgets it. */
  forget(roomId: string): void {
    this.live.drop(roomId);
    this.throttle.clear(roomId);
    this.screen.forget(roomId);
    this.cancelGrace(roomId, false);
  }

  /** Replays a change made on another instance. */
  apply(op: RoomStateOp): void {
    switch (op.t) {
      case 'sync':
        return this.live.sync(op.roomId, op.state, op.positionSeconds);
      case 'host':
        return this.live.setHost(op.roomId, op.hostUserId);
      case 'vote':
        return void this.live.vote(op.roomId, op.userId, Number.MAX_SAFE_INTEGER);
      case 'drop':
        return this.forget(op.roomId);
      case 'hostBack':
        return this.cancelGrace(op.roomId, true);
      case 'unseat':
        return this.unseatHere(op.roomId, op.userId, op.keepSocketId);
      case 'chat':
        return this.screen.remember(op.roomId, op.message);
      case 'ad':
        return void this.screen.setAd(op.roomId, op.ad);
      case 'quality':
        return void this.screen.setQuality(op.roomId, op.quality);
    }
  }

  /** One seat per member per room (edge 5.2): a socket of this instance lost it to another device. */
  unseatHere(roomId: string, userId: string, keepSocketId: string): void {
    const old = this.seats.holder(roomId, userId);
    if (!old || old.id === keepSocketId) return;
    this.seats.release(roomId, userId);
    old.emit(ROOM_EVENT.SESSION_REPLACED, { roomId, reason: 'Bạn đã tham gia phòng này từ một thiết bị khác' });
    void old.leave(ROOM_CHANNEL(roomId));
    (old.data as { roomId?: string }).roomId = undefined;
  }

  /** The 5 s pulse: HEARTBEAT_SYNC for drift (edge 2.2) and the pause-too-long ladder (edge 3.3). */
  async pulse(): Promise<void> {
    const server = this.server;
    if (!server) return;
    for (const roomId of this.live.roomIds()) {
      const sockets = await server.local.in(ROOM_CHANNEL(roomId)).fetchSockets();
      if (!sockets.length) {
        this.live.drop(roomId);
        this.throttle.clear(roomId);
        continue;
      }
      const room = this.live.get(roomId)!;
      server.local.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.HEARTBEAT_SYNC, {
        state: room.state,
        positionSeconds: this.live.positionNow(roomId),
        serverTimestamp: Date.now(),
      });
      const step = this.live.inactivityStep(roomId);
      if (step === 'WARN_HOST' && room.hostUserId) {
        server.local.to(USER_CHANNEL(room.hostUserId)).emit(ROOM_EVENT.HOST_INACTIVE, { roomId });
      } else if (step === 'OPEN_VOTE') {
        server.local.to(ROOM_CHANNEL(roomId)).emit(ROOM_EVENT.VOTE_OPEN, { roomId });
      }
    }
  }
}
