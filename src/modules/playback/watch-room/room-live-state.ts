import { HOST_PAUSE_WARN_MS, HOST_VOTE_OPEN_MS, SEEK_THROTTLE_MS } from './room-events';

export type LivePlaybackState = 'PLAYING' | 'PAUSED' | 'ENDED';

/** What the gateway remembers about a room between database writes. */
export interface LiveRoom {
  state: LivePlaybackState;
  positionSeconds: number;
  /** ms clock when `positionSeconds` was true. */
  syncedAt: number;
  hostUserId: string | null;
  pausedSince: number | null;
  inactivityWarned: boolean;
  voteOpen: boolean;
  votes: Set<string>;
}

/** What the 5 s heartbeat says about a paused room that sat too long (edge 3.3). */
export type InactivityStep = 'WARN_HOST' | 'OPEN_VOTE' | null;

/**
 * The gateway's in-memory picture of every room with sockets in it: the Host clock between pings
 * (edge 2.2), the pause that grows into a vote (edge 3.3), and the votes themselves. Nothing here
 * survives a restart on purpose — the rooms table does.
 */
export class LiveRooms {
  private readonly rooms = new Map<string, LiveRoom>();

  seed(roomId: string, hostUserId: string | null, state: LivePlaybackState, positionSeconds: number): void {
    if (this.rooms.has(roomId)) return;
    this.rooms.set(roomId, {
      state,
      positionSeconds,
      syncedAt: Date.now(),
      hostUserId,
      pausedSince: state === 'PAUSED' ? Date.now() : null,
      inactivityWarned: false,
      voteOpen: false,
      votes: new Set(),
    });
  }

  /** The Host synced: the clock restarts and any pause bookkeeping follows the new state. */
  sync(roomId: string, state: LivePlaybackState, positionSeconds: number, now = Date.now()): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.state = state;
    room.positionSeconds = positionSeconds;
    room.syncedAt = now;
    room.pausedSince = state === 'PAUSED' ? (room.pausedSince ?? now) : null;
    if (state !== 'PAUSED') {
      room.inactivityWarned = false;
      room.voteOpen = false;
      room.votes.clear();
    }
  }

  setHost(roomId: string, hostUserId: string | null): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.hostUserId = hostUserId;
    room.pausedSince = room.state === 'PAUSED' ? Date.now() : null;
    room.inactivityWarned = false;
    room.voteOpen = false;
    room.votes.clear();
  }

  get(roomId: string): LiveRoom | undefined {
    return this.rooms.get(roomId);
  }

  drop(roomId: string): void {
    this.rooms.delete(roomId);
  }

  roomIds(): string[] {
    return [...this.rooms.keys()];
  }

  /** The position now: extrapolated from the last sync while the room plays (edges 2.1, 2.2). */
  positionNow(roomId: string, now = Date.now()): number | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.state !== 'PLAYING') return room.positionSeconds;
    return room.positionSeconds + Math.max(0, (now - room.syncedAt) / 1000);
  }

  /** Called by the heartbeat: has this paused room crossed the warn or the vote threshold? */
  inactivityStep(roomId: string, now = Date.now()): InactivityStep {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'PAUSED' || room.pausedSince === null) return null;
    const pausedFor = now - room.pausedSince;
    if (pausedFor >= HOST_VOTE_OPEN_MS && !room.voteOpen) {
      room.voteOpen = true;
      return 'OPEN_VOTE';
    }
    if (pausedFor >= HOST_PAUSE_WARN_MS && !room.inactivityWarned) {
      room.inactivityWarned = true;
      return 'WARN_HOST';
    }
    return null;
  }

  /**
   * One member's vote to move the Host seat (edge 3.3). Counts only while the vote is open, and
   * answers true when more than half of the active non-Host members want the transfer.
   */
  vote(roomId: string, userId: string, activeNonHostCount: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.voteOpen || userId === room.hostUserId) return false;
    room.votes.add(userId);
    return room.votes.size * 2 > activeNonHostCount;
  }
}

/**
 * Edge 2.3 — the Host seek throttle: at most one SYNC_PLAYBACK broadcast per 500 ms per room;
 * the last payload inside a window always goes out at its end, so the room lands where the Host
 * let go of the slider.
 */
export class PlaybackThrottle {
  private readonly lastSentAt = new Map<string, number>();
  private readonly pending = new Map<string, { payload: unknown; timer: ReturnType<typeof setTimeout> }>();

  /** Sends now when the window is clear, else queues the payload for the window's end. */
  offer(roomId: string, payload: unknown, send: (payload: unknown) => void, now = Date.now()): void {
    const last = this.lastSentAt.get(roomId) ?? 0;
    const wait = last + SEEK_THROTTLE_MS - now;
    const queued = this.pending.get(roomId);
    if (wait <= 0 && !queued) {
      this.lastSentAt.set(roomId, now);
      send(payload);
      return;
    }
    if (queued) {
      clearTimeout(queued.timer);
    }
    const timer = setTimeout(
      () => {
        this.pending.delete(roomId);
        this.lastSentAt.set(roomId, Date.now());
        send(payload);
      },
      Math.max(wait, 1),
    );
    this.pending.set(roomId, { payload, timer });
  }

  clear(roomId: string): void {
    const queued = this.pending.get(roomId);
    if (queued) clearTimeout(queued.timer);
    this.pending.delete(roomId);
    this.lastSentAt.delete(roomId);
  }
}
