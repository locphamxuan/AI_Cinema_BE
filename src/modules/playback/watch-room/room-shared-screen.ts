/**
 * Shared-screen state of a watch room (BR-69, 13/11/2026): the room watches one screen, the Host's.
 * The Host's mid-roll ad is shown to everyone until the Host skips it, the Host picks the stream
 * quality for the whole room, and the members chat beside the player. Kept in memory: a room lives
 * for one viewing, so its chat and screen state go with it.
 */

export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_MAX_LENGTH = 300;
/** At most this many messages per member per window (anti-spam). */
export const CHAT_BURST_LIMIT = 5;
export const CHAT_BURST_WINDOW_MS = 5_000;
/** A room idle this long is forgotten on the next write. */
export const ROOM_STATE_TTL_MS = 6 * 60 * 60 * 1000;

/** `auto` = adaptive; otherwise a rendition name of the HLS ladder (`1080p`, `720p`, …). */
export const QUALITY_PATTERN = /^(auto|\d{3,4}p)$/;

export interface RoomChatMessage {
  id: string;
  userId: string;
  fullName: string;
  text: string;
  sentAt: number;
}

/** The ad the Host is watching, mirrored to every member (who cannot skip it). */
export interface RoomAdState {
  active: boolean;
  title?: string;
  mediaUrl?: string;
  durationSeconds?: number;
  startedAt?: number;
}

export interface RoomScreen {
  quality: string;
  ad: RoomAdState;
  chat: RoomChatMessage[];
}

export type ChatRejection = 'EMPTY' | 'TOO_LONG' | 'RATE_LIMITED';

interface RoomRecord extends RoomScreen {
  touchedAt: number;
  bursts: Map<string, number[]>;
}

export class RoomSharedScreen {
  private readonly rooms = new Map<string, RoomRecord>();
  private seq = 0;

  /** What a member who just joined needs to catch up: quality, the running ad, the chat so far. */
  snapshot(roomId: string): RoomScreen {
    const room = this.rooms.get(roomId);
    return room
      ? { quality: room.quality, ad: room.ad, chat: [...room.chat] }
      : { quality: 'auto', ad: { active: false }, chat: [] };
  }

  /** Validates and stores a chat line; answers the stored message or why it was refused. */
  chat(
    roomId: string,
    author: { userId: string; fullName: string },
    raw: unknown,
    now = Date.now(),
  ): RoomChatMessage | ChatRejection {
    const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!text) return 'EMPTY';
    if (text.length > CHAT_MAX_LENGTH) return 'TOO_LONG';
    const room = this.touch(roomId, now);
    const recent = (room.bursts.get(author.userId) ?? []).filter((t) => now - t < CHAT_BURST_WINDOW_MS);
    if (recent.length >= CHAT_BURST_LIMIT) return 'RATE_LIMITED';
    room.bursts.set(author.userId, [...recent, now]);
    const message: RoomChatMessage = { id: `${now}-${++this.seq}`, ...author, text, sentAt: now };
    room.chat = [...room.chat, message].slice(-CHAT_HISTORY_LIMIT);
    return message;
  }

  /** The Host's ad started (with what everyone shows) or ended. */
  setAd(roomId: string, ad: RoomAdState, now = Date.now()): RoomAdState {
    const next: RoomAdState = ad.active
      ? {
          active: true,
          title: ad.title?.slice(0, 200),
          mediaUrl: ad.mediaUrl,
          durationSeconds: ad.durationSeconds,
          startedAt: now,
        }
      : { active: false };
    this.touch(roomId, now).ad = next;
    return next;
  }

  /** The Host's quality choice; null when the value is not a known rendition name. */
  setQuality(roomId: string, quality: unknown, now = Date.now()): string | null {
    if (typeof quality !== 'string' || !QUALITY_PATTERN.test(quality)) return null;
    this.touch(roomId, now).quality = quality;
    return quality;
  }

  forget(roomId: string): void {
    this.rooms.delete(roomId);
  }

  private touch(roomId: string, now: number): RoomRecord {
    for (const [id, room] of this.rooms) if (now - room.touchedAt > ROOM_STATE_TTL_MS) this.rooms.delete(id);
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { quality: 'auto', ad: { active: false }, chat: [], touchedAt: now, bursts: new Map() };
      this.rooms.set(roomId, room);
    }
    room.touchedAt = now;
    return room;
  }
}

export const isChatRejection = (value: RoomChatMessage | ChatRejection): value is ChatRejection =>
  typeof value === 'string';
