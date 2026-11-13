/**
 * Who is connected and where (edges 5.2, 7.2): one seat per member per room, and the sockets each
 * member holds. The gateway asks it who to unseat when a second device enters the same room, and
 * whether a friend is online before choosing socket or notification for an invite.
 */
export class RoomSeats<S extends { id: string }> {
  /** `${roomId}|${userId}` → socket id. */
  private readonly seats = new Map<string, string>();
  /** userId → socket ids. */
  private readonly presence = new Map<string, Set<string>>();
  private readonly sockets = new Map<string, S>();

  connect(userId: string, socket: S): void {
    this.sockets.set(socket.id, socket);
    const mine = this.presence.get(userId) ?? new Set<string>();
    mine.add(socket.id);
    this.presence.set(userId, mine);
  }

  /** Forgets the socket; answers true when it held the member's seat in `roomId`. */
  disconnect(userId: string | undefined, socketId: string, roomId: string | undefined): boolean {
    this.sockets.delete(socketId);
    if (!userId) return false;
    const mine = this.presence.get(userId);
    mine?.delete(socketId);
    if (mine && mine.size === 0) this.presence.delete(userId);
    if (roomId && this.seats.get(seatKey(roomId, userId)) === socketId) {
      this.seats.delete(seatKey(roomId, userId));
      return true;
    }
    return false;
  }

  /** Seats the socket; answers the socket it displaced, if another device held the seat. */
  take(roomId: string, userId: string, socket: S): S | undefined {
    const previous = this.seats.get(seatKey(roomId, userId));
    this.seats.set(seatKey(roomId, userId), socket.id);
    return previous && previous !== socket.id ? this.sockets.get(previous) : undefined;
  }

  release(roomId: string, userId: string): void {
    this.seats.delete(seatKey(roomId, userId));
  }

  isSeated(roomId: string, userId: string): boolean {
    return this.seats.has(seatKey(roomId, userId));
  }

  isOnline(userId: string): boolean {
    return this.presence.has(userId);
  }
}

const seatKey = (roomId: string, userId: string) => `${roomId}|${userId}`;
